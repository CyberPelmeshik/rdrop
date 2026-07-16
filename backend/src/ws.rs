use axum::{
    Router,
    extract::State,
    extract::ws::{WebSocket, WebSocketUpgrade},
    response::{IntoResponse, Response},
    routing::any,
};
use std::time::Duration;
use tokio::time::interval;
use uuid::Uuid;

use crate::AppState;

enum Message {
    Text(String),
    Binary(Vec<u8>),
    Ping,
    Pong,
    Close,
}

pub async fn handler(ws: WebSocketUpgrade, state: State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: State<AppState>) {
    let mut number = 0;
    let mut timer = interval(Duration::from_secs(5));

    loop {
        timer.tick().await;
        //println!("Tick, отправляю клиенту {}", number);
        socket
            .send(format!("Hello {}", number).into())
            .await
            .unwrap();
        number += 1;

        while let Some(msg) = socket.recv().await {
            if let Ok(inner_msg) = msg {
                println!("Получено сообщение: {}", inner_msg.to_text().unwrap());
                socket.send(inner_msg.into()).await.unwrap();
            } else {
                // client  disconnected
                return;
            }
        }
    }
}
