// public/platform/config.js
// Dónde vive el servidor Socket.IO. En local (o en la LAN) es el mismo
// origen que sirve la página, así que queda vacío y io() se conecta solo.
// En el deploy público el front estático está en Vercel, que no puede
// mantener WebSockets ni salas en memoria — el servidor corre en Render y
// el cliente se conecta directo ahí (ver vercel.json y README).
window.PLATFORM_SERVER_URL = (function () {
  const host = window.location.hostname;
  const isLocal =
    host === "localhost" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return isLocal ? "" : "https://qrmania.onrender.com";
})();
