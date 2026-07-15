use axum::{Router, http::StatusCode, response::Html, routing::any, routing::get, routing::post};
use tower_http::services::{ServeDir, ServeFile};

mod ws;
use ws::handler;

//async fn post_file() {

//}

#[tokio::main]
async fn main() {
    let app = Router::new().route("/ws", any(ws::handler));

    // run our app with hyper, listening globally on port 3000
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
