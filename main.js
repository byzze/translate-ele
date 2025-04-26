const { app, BrowserWindow, screen, nativeImage, Tray, Menu, clipboard } = require('electron');
const path = require('path');
const { GlobalKeyboardListener } = require('node-global-key-listener');
const chokidar = require('chokidar');
const log = require('electron-log');
const { keyboard, Key } = require('@nut-tree/nut-js');

// 配置日志
log.transports.file.level = 'debug';
log.transports.console.level = 'debug';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';

let mainWindow;
let popupWindow;
let keyboardListener;
let tray;
let isPopupReady = false;
let lastSelectedText = '';

function createMainWindow() {
    log.info('Creating main window...');
    mainWindow = new BrowserWindow({
        width: 400,
        height: 300,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');
    log.info('Main window created successfully');
}

function createPopupWindow() {
    log.info('Creating popup window...');
    if (popupWindow) {
        try {
            popupWindow.close();
        } catch (error) {
            log.error('Error closing existing popup window:', error);
        }
    }

    popupWindow = new BrowserWindow({
        width: 300,
        height: 200,
        frame: false,
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    popupWindow.loadFile('popup.html');
    popupWindow.hide();
    isPopupReady = false;

    // 监听窗口关闭事件
    popupWindow.on('closed', () => {
        log.info('Popup window closed');
        popupWindow = null;
        isPopupReady = false;
    });

    // 监听页面加载完成事件
    popupWindow.webContents.on('did-finish-load', () => {
        isPopupReady = true;
        log.info('Popup window ready');
    });

    log.info('Popup window created successfully');
}

function createTray() {
    log.info('Creating system tray...');
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => mainWindow.show() },
        { label: '退出', click: () => app.quit() }
    ]);
    tray.setToolTip('text selection popup tool');
    tray.setContextMenu(contextMenu);
    log.info('System tray created successfully');
}

function showPopupWindow(x, y, text) {
    log.info(`Showing popup window at position: x=${x}, y=${y}`);

    // 如果弹窗不存在或已销毁，重新创建
    if (!popupWindow || popupWindow.isDestroyed()) {
        createPopupWindow();
        // 等待弹窗准备就绪
        const checkReady = setInterval(() => {
            if (isPopupReady) {
                clearInterval(checkReady);
                updatePopupContent(x, y, text);
            }
        }, 50);
    } else {
        updatePopupContent(x, y, text);
    }
}

function updatePopupContent(x, y, text) {
    try {
        if (popupWindow && !popupWindow.isDestroyed()) {
            popupWindow.webContents.send('update-text', text);
            popupWindow.setPosition(x + 20, y + 20);
            popupWindow.show();
            log.info('Popup window updated with text:', text);
        }
    } catch (error) {
        log.error('Error updating popup content:', error);
    }
}

function hidePopupWindow() {
    log.info('Hiding popup window...');
    if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
        try {
            popupWindow.hide();
            log.info('Popup window hidden successfully');
        } catch (error) {
            log.error('Error hiding popup window:', error);
        }
    }
}

function isClickInsidePopupWindow(x, y) {
    if (!popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible()) {
        return false;
    }

    try {
        const [popupX, popupY] = popupWindow.getPosition();
        const [popupWidth, popupHeight] = popupWindow.getSize();

        return x >= popupX && x <= popupX + popupWidth &&
            y >= popupY && y <= popupY + popupHeight;
    } catch (error) {
        log.error('Error checking click position:', error);
        return false;
    }
}

function setupFileWatcher() {
    log.info('Setting up file watcher...');
    const watcher = chokidar.watch(['*.html', '*.css', '*.js'], {
        ignored: /(^|[\/\\])\../, // 忽略隐藏文件
        persistent: true
    });

    watcher.on('change', (path) => {
        log.info(`File ${path} has been changed`);
        if (path === 'index.html' && mainWindow) {
            log.info('Reloading main window...');
            mainWindow.reload();
        }
        if (path === 'popup.html' && popupWindow && !popupWindow.isDestroyed()) {
            log.info('Reloading popup window...');
            popupWindow.reload();
        }
    });

    log.info('File watcher setup completed');
}

app.whenReady().then(async () => {
    log.info('App is ready, initializing...');
    createMainWindow();
    createPopupWindow();
    createTray();
    setupFileWatcher();

    // Create global keyboard listener
    log.info('Initializing global keyboard listener...');
    keyboardListener = new GlobalKeyboardListener();

    // 监听鼠标中键事件
    keyboardListener.addListener(async (e) => {
        log.debug('Received event:', e);
        if (e.name === 'MOUSE MIDDLE') {
            log.info('Middle mouse button detected');
            const { x, y } = screen.getCursorScreenPoint();
            log.debug(`Cursor position: x=${x}, y=${y}`);

            try {
                // 模拟 Ctrl+C
                await keyboard.pressKey(Key.LeftControl);
                await keyboard.pressKey(Key.C);
                await keyboard.releaseKey(Key.C);
                await keyboard.releaseKey(Key.LeftControl);

                // 获取选中的文本
                const selectedText = clipboard.readText();

                // 只有当文本发生变化时才更新弹窗
                if (selectedText !== lastSelectedText) {
                    lastSelectedText = selectedText;
                    log.debug(`Selected text: ${selectedText}`);
                    showPopupWindow(x, y, selectedText);
                }
            } catch (error) {
                log.error('Error simulating keyboard:', error);
            }
        } else if (e.name === 'MOUSE LEFT' || e.name === 'MOUSE RIGHT') {
            const { x, y } = screen.getCursorScreenPoint();
            log.debug(`Click position: x=${x}, y=${y}`);

            // Only hide popup if click is outside the popup window
            if (!isClickInsidePopupWindow(x, y)) {
                log.info('Click outside popup window, hiding popup');
                hidePopupWindow();
            } else {
                log.info('Click inside popup window, keeping popup visible');
            }
        }
    });
    log.info('Global keyboard listener initialized successfully');
});

app.on('window-all-closed', () => {
    log.info('All windows closed, cleaning up...');
    if (keyboardListener) {
        log.info('Killing keyboard listener');
        keyboardListener.kill();
    }
    if (process.platform !== 'darwin') {
        log.info('Quitting application');
        app.quit();
    }
});

app.on('activate', () => {
    log.info('App activated');
    if (BrowserWindow.getAllWindows().length === 0) {
        log.info('No windows found, creating main window');
        createMainWindow();
    }
}); 