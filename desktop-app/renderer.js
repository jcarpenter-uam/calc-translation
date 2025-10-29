document.getElementById("minimize-btn").addEventListener("click", () => {
  window.electronAPI.minimize();
});

document.getElementById("maximize-btn").addEventListener("click", () => {
  window.electronAPI.maximize();
});

document.getElementById("close-btn").addEventListener("click", () => {
  window.electronAPI.close();
});

const webview = document.getElementById("content-view");

webview.addEventListener("dom-ready", () => {
  webview.openDevTools();
  const defaultFontSize = 20;
  const jsCode = `document.documentElement.style.fontSize = '${defaultFontSize}px';`;
  webview.executeJavaScript(jsCode).catch((err) => console.error(err));
});

window.electronAPI.onFontChangeRequest((action, defaultSize) => {
  let jsCode = "";

  if (action === "increase") {
    jsCode = `
      (function() {
        const el = document.documentElement;
        let currentSize = parseFloat(window.getComputedStyle(el).fontSize);
        if (isNaN(currentSize)) { currentSize = 16; }
        el.style.fontSize = (currentSize + 1) + 'px';
      })();
    `;
  } else if (action === "decrease") {
    jsCode = `
      (function() {
        const el = document.documentElement;
        let currentSize = parseFloat(window.getComputedStyle(el).fontSize);
        if (isNaN(currentSize)) { currentSize = 16; }
        el.style.fontSize = (currentSize - 1) + 'px';
      })();
    `;
  } else if (action === "reset") {
    jsCode = `document.documentElement.style.fontSize = '${defaultSize}px';`;
  }

  if (jsCode) {
    webview.executeJavaScript(jsCode).catch((err) => {
      console.error("Failed to execute font JS in webview:", err);
    });
  }
});
