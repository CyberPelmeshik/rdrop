use axum::{
    Router, extract::ws::Message, http::StatusCode, response::Html, routing::any, routing::get,
    routing::post,
};
use tokio::sync::mpsc;

use tower_http::services::{ServeDir, ServeFile};

mod ws;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use uuid::Uuid;

#[derive(Clone)]
pub struct FileMeta {
    pub name: String,
    pub size: u64,
    pub path: String,
    pub owner: String,
    pub uploaded_at: std::time::SystemTime,
}

#[derive(Clone)]
pub struct Files {
    pub info: Arc<RwLock<HashMap<Uuid, FileMeta>>>,
}

pub struct User {
    pub name: String,
    pub sender: mpsc::UnboundedSender<Message>,
    //pub ip: std::net::Ipv4Addr,
}

#[derive(Clone)]
pub struct AppState {
    pub info: Arc<RwLock<HashMap<Uuid, User>>>,
}

async fn uuid_handler(mut uuids: Vec<Uuid>) -> Uuid {
    let uuid = Uuid::new_v4();
    uuids.push(uuid);
    uuid
}

#[tokio::main]
async fn main() {
    let state: AppState = AppState {
        info: Arc::new(RwLock::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/ws", any(ws::handler))
        .with_state(state);

    // run our app with hyper, listening globally on port 3000
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
