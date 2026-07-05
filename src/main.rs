use axum::{Router, http::StatusCode, response::Html, routing::get};
use tower_http::services::{ServeDir, ServeFile};
mod db;

//async fn post_file() {

//}

#[tokio::main]
async fn main() {
    db::init_db().await.unwrap();

    //let index_html = ServeFile::new("static/index.html");

    // build our application with a single route
    let app = Router::new()
        .route("/", get(Html(include_str!("../static/index.html"))))
        .fallback_service(ServeDir::new("static"));

    // run our app with hyper, listening globally on port 3000
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
