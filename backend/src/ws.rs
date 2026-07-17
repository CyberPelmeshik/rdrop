use axum::{
    Router,
    extract::State,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::{IntoResponse, Response},
    routing::any,
};
use std::{num::ParseIntError, time::Duration};
use tokio::sync::mpsc;
use tokio::time::interval;
use uuid::Uuid;

use crate::AppState;

#[derive(serde::Deserialize)]
struct Command {
    name: String,
    args: Vec<String>,
}

pub async fn handler(ws: WebSocketUpgrade, state: State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: State<AppState>) {
    let user_id: Uuid = Uuid::new_v4();
    let (tx, rx) = mpsc::unbounded_channel();

    state.info.write().unwrap().insert(
        user_id,
        crate::User {
            name: "".to_string(),
            sender: tx,
        },
    );

    loop {
        /*
        timer.tick().await;
        //println!("Tick, отправляю клиенту {}", number);
        socket
            .send(format!("Hello {}", number).into())
            .await
            .unwrap();
        number += 1;
        */
        tokio::select! {
            msg = socket.recv() => {
                Some(Ok(msg)) => match msg {
                    Message::Text(text) => {
                        let json_ = serde_json::from_str::<Command>(&text);
                        if let Ok(command) = json_ {
                            match command.name.as_str() {
                                "ping" => {
                                    socket.send(Message::Text("pong".into())).await.unwrap();
                                }
                                "change_name" => {
                                    if let Some(new_name) = command.args.get(0) {
                                        if let Some(info) =
                                            state.info.write().unwrap().get_mut(&user_id)
                                        {
                                            info.name = new_name.clone();
                                        }
                                    };
                                }
                                "create_chanel" => {
                                    if let Some(new_name) = command.args.get(0) {
                                        if let Some(info) =
                                            state.info.write().unwrap().get_mut(&user_id)
                                        {
                                            info.name = new_name.clone();
                                        }
                                    };
                                }
                                _ => {}
                            }
                        }
                    }
                    Message::Binary(_) => {}
                    Message::Ping(_) => {}
                    Message::Pong(_) => {}
                    Message::Close(_) => {}
                },
                Some(Err(_)) => {
                    state.info.write().unwrap().remove(&user_id);
                    println!("Отключился юзер {}", user_id);
                    return;
                }
                None => {
                    state.info.write().unwrap().remove(&user_id);
                    println!("Отключился юзер {}", user_id);
                    return;
                }
            }

        }
    }
}
