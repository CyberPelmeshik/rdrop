use axum::{
    Router,
    extract::State,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::{IntoResponse, Response},
    routing::any,
};
use std::{num::ParseIntError, time::Duration};
use tokio::sync::mpsc::{self, UnboundedSender};
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

pub fn send_users(state: &State<AppState>, current_user: &Uuid) -> Message {
    let users = state.info.read().unwrap();
    let mut users_info: Vec<serde_json::Value> = Vec::new();

    for (uuid, user) in users.iter() {
        if uuid != current_user {
            users_info
                .push(serde_json::json!({"id" : uuid.to_string(), "name": user.name.clone()}));
        }
    }

    Message::Text(
        serde_json::json!({ "type": "user_list", "users": users_info})
            .to_string()
            .into(),
    )
}

pub fn broadcast_users(state: &State<AppState>) {
    let users = state.info.read().unwrap();
    let mut users_info: Vec<serde_json::Value> = Vec::new();
    let mut senders: Vec<mpsc::UnboundedSender<Message>> = Vec::new();

    for (uuid, user) in users.iter() {
        users_info.push(serde_json::json!({"id" : uuid.to_string(), "name": user.name.clone()}));
        senders.push(user.sender.clone());
    }

    let users_json = serde_json::json!({ "type": "user_list", "users": users_info}).to_string();

    for sender in senders.iter() {
        let _ = sender.send(users_json.clone().into());
    }
}

fn delete_user(user_id: &Uuid, state: State<AppState>) {
    state.info.write().unwrap().remove(&user_id);
    broadcast_users(&state);
    println!("Отключился юзер {}", user_id);
}

async fn handle_socket(mut socket: WebSocket, state: State<AppState>) {
    let user_id: Uuid = Uuid::new_v4();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut relay_target: Option<Uuid> = None;

    state.info.write().unwrap().insert(
        user_id,
        crate::User {
            name: "".to_string(),
            sender: tx,
        },
    );

    let welcom_msg = Message::Text(
        serde_json::json!({ "type": "welcome", "id": user_id.to_string()})
            .to_string()
            .into(),
    );

    let _ = socket.send(welcom_msg).await.unwrap();

    broadcast_users(&state);

    loop {
        tokio::select! {
            msg = socket.recv() => {
                    match msg {
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
                                            broadcast_users(&state);
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
                                    "sent_to" => {
                                        if let Some(sent_to) = command.args.get(0) {
                                            if let Ok(r_target) = Uuid::parse_str(sent_to) {
                                                relay_target = r_target.into();
                                            }
                                        };
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Message::Binary(data) => {
                            if let Some(target_id) = relay_target {
                                if let Some(target_user) = state.info.read().unwrap().get(&target_id) {
                                    let tx_target = target_user.sender.clone();
                                    let _ = tx_target.send(Message::Binary(data));
                                }
                            }
                        }
                        Message::Ping(_) => {}
                        Message::Pong(_) => {}
                        Message::Close(_) => {}
                    },
                    Some(Err(_)) => {
                        delete_user(&user_id, state);
                        return;
                    }
                    None => {
                        delete_user(&user_id, state);
                        return;
                    }
                }
            }

            forward_msg = rx.recv() => {
                if let Some(msg) = forward_msg {
                    if socket.send(msg).await.is_err() { break; }
                }
                else {
                    break;
                }
            }
        }
    }
}
