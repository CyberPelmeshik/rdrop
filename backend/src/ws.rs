use axum::{
    Router,
    extract::ws::{WebSocket, WebSocketUpgrade},
    response::{IntoResponse, Response},
    routing::any,
};
use std::time::Duration;
use tokio::time::interval;

pub async fn handler(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    let mut number = 0;
    let mut timer = interval(Duration::from_secs(5));

    loop {
        timer.tick().await;
        println!("Tick, отправляю клиенту {}", number);
        socket
            .send(format!("Hello {}", number).into())
            .await
            .unwrap();
        number += 1;
    }
    /*
    while let Some(msg) = socket.recv().await {
        if socket.send(msg).await.is_err() {
            // client disconnected
            return;
        }
    }
    */
}
