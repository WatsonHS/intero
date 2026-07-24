use std::io;

use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;

pub async fn read_frame<T, R>(reader: &mut R) -> io::Result<T>
where
    T: DeserializeOwned,
    R: AsyncRead + Unpin,
{
    let length = reader.read_u32().await? as usize;
    if length > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "IPC frame exceeds the 2 MiB limit",
        ));
    }
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body).await?;
    serde_json::from_slice(&body).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

pub async fn write_frame<T, W>(writer: &mut W, value: &T) -> io::Result<()>
where
    T: Serialize,
    W: AsyncWrite + Unpin,
{
    let body = serde_json::to_vec(value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if body.len() > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "IPC frame exceeds the 2 MiB limit",
        ));
    }
    let length = u32::try_from(body.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "frame is too large"))?;
    writer.write_u32(length).await?;
    writer.write_all(&body).await?;
    writer.flush().await
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};
    use tokio::io::duplex;

    use super::{read_frame, write_frame};

    #[derive(Debug, Deserialize, PartialEq, Serialize)]
    struct Payload {
        value: String,
    }

    #[tokio::test]
    async fn round_trips_a_length_prefixed_frame() {
        let (mut client, mut server) = duplex(1_024);
        let writer = tokio::spawn(async move {
            write_frame(
                &mut client,
                &Payload {
                    value: "bounded".into(),
                },
            )
            .await
        });
        let received: Payload = read_frame(&mut server).await.expect("frame should parse");
        writer
            .await
            .expect("writer should join")
            .expect("write should pass");
        assert_eq!(received.value, "bounded");
    }
}
