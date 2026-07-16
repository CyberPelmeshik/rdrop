use std::str;

use axum::{Router, http::StatusCode, response::Html, routing::any, routing::get, routing::post};
use tower_http::services::{ServeDir, ServeFile};

mod ws;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub info: Arc<RwLock<HashMap<Uuid, String>>>,
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
