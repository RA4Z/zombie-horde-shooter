// public/heartbeatWorker.js
setInterval(() => {
    postMessage('tick');
}, 33);