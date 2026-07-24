use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod generated {
    progenitor_macro::generate_api!("../../packages/api-contracts/generated/openapi.json");
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicProjection {
    pub workstream_id: String,
    pub version: u64,
    pub phase: String,
    pub freshness_at: String,
}

#[derive(Debug, Error)]
pub enum ServerApiError {
    #[error("server API is offline")]
    Offline,
    #[error("server rejected the projection: {0}")]
    Rejected(String),
}

pub trait ServerApi: Send + Sync {
    /// Publishes a versioned public projection with an idempotency boundary.
    ///
    /// # Errors
    ///
    /// Returns [`ServerApiError`] when the public service is offline or rejects
    /// the projection.
    fn publish_projection(
        &self,
        projection: &PublicProjection,
        idempotency_key: &str,
    ) -> Result<(), ServerApiError>;
}
