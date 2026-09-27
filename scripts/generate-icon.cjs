const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

app.disableHardwareAcceleration();

async function generateIcon() {
  const svgPath = path.resolve(process.cwd(), "build", "icon.svg");
  const pngPath = path.resolve(process.cwd(), "build", "icon.png");
  const svg = await fs.readFile(svgPath, "utf8");
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const document = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          html, body { width: 512px; height: 512px; margin: 0; overflow: hidden; background: transparent; }
          svg { display: block; width: 512px; height: 512px; }
        </style>
      </head>
      <body>${svg}</body>
    </html>`;

  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(document)}`,
  );
  const image = await window.webContents.capturePage({
    x: 0,
    y: 0,
    width: 512,
    height: 512,
  });
  window.destroy();
  if (image.isEmpty()) throw new Error("Generated icon is empty");
  await fs.writeFile(pngPath, image.toPNG());
  console.log(`Generated ${pngPath}`);
}

app
  .whenReady()
  .then(generateIcon)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
