let socket = new WebSocket("ws://localhost:3000/ws");

socket.onopen = function(e) {
  console.log("[open] Соединение установлено");
  console.log("Отправляем данные на сервер");
  socket.send("Меня зовут Джон");
};


socket.onmessage = function(event) {
   console.log(`[message] Данные получены с сервера: ${event.data}`);
};

function sendMessage() {
   let message = document.getElementById("message").value;
   socket.send(message);
}