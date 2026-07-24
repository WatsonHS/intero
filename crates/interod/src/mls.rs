use std::collections::HashMap;

use anyhow::{Context, Result, anyhow};
use openmls::prelude::{tls_codec::*, *};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

/// Device-local `OpenMLS` state. The delivery service only transports the
/// returned opaque bytes; plaintext and key material stay with the device.
pub struct OpenMlsDevice {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    groups: HashMap<Vec<u8>, MlsGroup>,
}

pub struct OpenMlsInvitation {
    pub welcome: Vec<u8>,
    pub ratchet_tree: Vec<u8>,
}

impl OpenMlsDevice {
    pub fn new(identity: &[u8]) -> Result<Self> {
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())
            .map_err(|error| anyhow!("generate MLS signature key: {error:?}"))?;
        signer
            .store(provider.storage())
            .map_err(|error| anyhow!("store MLS signature key: {error:?}"))?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity.to_vec()).into(),
            signature_key: signer.public().into(),
        };
        Ok(Self {
            provider,
            signer,
            credential,
            groups: HashMap::new(),
        })
    }

    pub fn key_package(&self) -> Result<Vec<u8>> {
        KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential.clone(),
            )
            .context("build MLS key package")?
            .key_package()
            .tls_serialize_detached()
            .context("serialize MLS key package")
    }

    pub fn create_group(&mut self, group_id: &[u8]) -> Result<()> {
        let group = MlsGroup::new_with_group_id(
            &self.provider,
            &self.signer,
            &MlsGroupCreateConfig::default(),
            GroupId::from_slice(group_id),
            self.credential.clone(),
        )
        .context("create MLS group")?;
        self.groups.insert(group_id.to_vec(), group);
        Ok(())
    }

    pub fn add_member(
        &mut self,
        group_id: &[u8],
        serialized_key_package: &[u8],
    ) -> Result<OpenMlsInvitation> {
        let key_package = KeyPackageIn::tls_deserialize_exact(serialized_key_package)
            .context("deserialize MLS key package")?
            .validate(self.provider.crypto(), ProtocolVersion::Mls10)
            .context("validate MLS key package")?;
        let group = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| anyhow!("MLS group was not found"))?;
        let (_, welcome, _) = group
            .add_members(
                &self.provider,
                &self.signer,
                std::slice::from_ref(&key_package),
            )
            .context("add MLS member")?;
        group
            .merge_pending_commit(&self.provider)
            .context("merge MLS membership commit")?;
        let ratchet_tree = group
            .export_ratchet_tree()
            .tls_serialize_detached()
            .context("serialize MLS ratchet tree")?;
        Ok(OpenMlsInvitation {
            welcome: welcome
                .tls_serialize_detached()
                .context("serialize MLS welcome")?,
            ratchet_tree,
        })
    }

    pub fn join_group(&mut self, invitation: &OpenMlsInvitation) -> Result<Vec<u8>> {
        let message = MlsMessageIn::tls_deserialize_exact(invitation.welcome.as_slice())
            .context("deserialize MLS welcome")?;
        let MlsMessageBodyIn::Welcome(welcome) = message.extract() else {
            return Err(anyhow!("MLS invitation did not contain a Welcome"));
        };
        let ratchet_tree = RatchetTreeIn::tls_deserialize_exact(invitation.ratchet_tree.as_slice())
            .context("deserialize MLS ratchet tree")?;
        let staged = StagedWelcome::new_from_welcome(
            &self.provider,
            &MlsGroupJoinConfig::default(),
            welcome,
            Some(ratchet_tree),
        )
        .context("stage MLS welcome")?;
        let group = staged
            .into_group(&self.provider)
            .context("join MLS group")?;
        let group_id = group.group_id().as_slice().to_vec();
        self.groups.insert(group_id.clone(), group);
        Ok(group_id)
    }

    pub fn encrypt(&mut self, group_id: &[u8], plaintext: &[u8]) -> Result<Vec<u8>> {
        let group = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| anyhow!("MLS group was not found"))?;
        group
            .create_message(&self.provider, &self.signer, plaintext)
            .context("encrypt MLS application message")?
            .tls_serialize_detached()
            .context("serialize MLS ciphertext")
    }

    pub fn decrypt(&mut self, group_id: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>> {
        let message = MlsMessageIn::tls_deserialize_exact(ciphertext)
            .context("deserialize MLS ciphertext")?
            .try_into_protocol_message()
            .context("validate MLS protocol message")?;
        let group = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| anyhow!("MLS group was not found"))?;
        let processed = group
            .process_message(&self.provider, message)
            .context("decrypt MLS application message")?;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => Ok(message.into_bytes()),
            _ => Err(anyhow!("MLS ciphertext was not an application message")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::OpenMlsDevice;

    #[test]
    fn encrypts_human_only_messages_end_to_end() {
        let group_id = b"thread:human-only:fixture";
        let mut alice = OpenMlsDevice::new(b"alice-device").expect("alice identity");
        let mut bob = OpenMlsDevice::new(b"bob-device").expect("bob identity");
        alice.create_group(group_id).expect("create group");
        let bob_key_package = bob.key_package().expect("bob key package");
        let invitation = alice
            .add_member(group_id, &bob_key_package)
            .expect("add bob");
        assert_eq!(bob.join_group(&invitation).expect("join group"), group_id);

        let plaintext = b"Only the enrolled devices can read this.";
        let ciphertext = alice.encrypt(group_id, plaintext).expect("encrypt");
        assert!(
            !ciphertext
                .windows(plaintext.len())
                .any(|window| window == plaintext)
        );
        assert_eq!(
            bob.decrypt(group_id, &ciphertext).expect("decrypt"),
            plaintext
        );
    }
}
