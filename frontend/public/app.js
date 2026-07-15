let socket = new WebSocket("ws://localhost:3000/ws");

socket.onmessage = function(event) {
   console.log(`[message] Данные получены с сервера: ${event.data}`);
};
