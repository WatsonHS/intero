use std::io;
use std::path::Path;
use std::sync::Arc;

use tokio::io::AsyncWriteExt;

use crate::framing::{read_frame, write_frame};
use crate::rpc::{JsonRpcRequest, RpcService};

#[cfg(unix)]
pub async fn serve(path: &Path, service: RpcService) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    use tokio::net::UnixListener;

    if tokio::fs::try_exists(path).await? {
        tokio::fs::remove_file(path).await?;
    }
    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    let expected_uid = std::os::unix::fs::MetadataExt::uid(&std::fs::metadata(path)?);
    let service = Arc::new(service);

    loop {
        let (mut stream, _) = listener.accept().await?;
        let peer = stream.peer_cred()?;
        if peer.uid() != expected_uid {
            stream.shutdown().await?;
            continue;
        }
        let service = Arc::clone(&service);
        tokio::spawn(async move {
            while let Ok(request) = read_frame::<JsonRpcRequest, _>(&mut stream).await {
                let response = service.handle(request);
                if write_frame(&mut stream, &response).await.is_err() {
                    break;
                }
            }
        });
    }
}

#[cfg(windows)]
pub async fn serve(path: &Path, service: RpcService) -> io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let pipe_name = path.to_string_lossy();
    loop {
        let mut server = ServerOptions::new()
            .first_pipe_instance(false)
            .create(&pipe_name)?;
        server.connect().await?;
        let service = service.clone();
        tokio::spawn(async move {
            while let Ok(request) = read_frame::<JsonRpcRequest, _>(&mut server).await {
                let response = service.handle(request);
                if write_frame(&mut server, &response).await.is_err() {
                    break;
                }
            }
        });
    }
}
