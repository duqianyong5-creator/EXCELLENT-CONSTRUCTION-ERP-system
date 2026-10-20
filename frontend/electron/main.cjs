const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');

// 未打包(开发)时为 true：加载 Vite 开发服务器；打包后加载本地 dist。
const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'ECT ERP',
    backgroundColor: '#0b1220',
    // 先不显示：最大化之后再 show，避免先弹出一个小窗再跳大
    show: false,
    icon: path.join(__dirname, '..', 'dist', 'log.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev, // 生产关闭开发者工具
      spellcheck: false,
    },
  });

  // 去掉菜单栏（同时也去掉了 View → Toggle DevTools 入口）
  Menu.setApplicationMenu(null);

  // 调度台是要一直开着看的，默认铺满屏幕；上面的 width/height 作为还原尺寸保留
  win.maximize();
  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // 外部链接用系统浏览器打开，不在应用内打开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 代码保护（仅生产）：禁用开发者工具 + 屏蔽查看源码/审查的快捷键
  if (!isDev) {
    win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());
    win.webContents.on('before-input-event', (event, input) => {
      const k = (input.key || '').toLowerCase();
      const block =
        k === 'f12' ||
        (input.control && input.shift && (k === 'i' || k === 'j' || k === 'c')) ||
        (input.control && k === 'u'); // Ctrl+U 查看源码
      if (block) event.preventDefault();
    });
  }
}

app.whenReady().then(() => {
  // Grant only the permissions the console actually uses (the full-screen map, alarm notifications,
  // the driver page's geolocation); Electron would otherwise grant every request.
  const allowed = new Set(['fullscreen', 'notifications', 'geolocation']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
