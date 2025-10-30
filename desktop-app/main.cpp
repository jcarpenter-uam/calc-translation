#include <QApplication>
#include <QMainWindow>
#include <QWebEngineView>
#include <QUrl>
#include <QObject>

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);

    QMainWindow mainWindow;
    mainWindow.setWindowTitle("Translucent Web Widget");
    mainWindow.resize(800, 300);

    mainWindow.setAttribute(Qt::WA_TranslucentBackground);
    mainWindow.setStyleSheet("background-color: transparent;");

    QWebEngineView *webView = new QWebEngineView(&mainWindow);

    webView->setAttribute(Qt::WA_TranslucentBackground);
    webView->setAutoFillBackground(false);
    webView->page()->setBackgroundColor(Qt::transparent);


    QObject::connect(webView, &QWebEngineView::loadFinished, [=](bool ok){
        if (ok) {
            // This JavaScript injects a <style> tag.
            // It targets the *exact* CSS classes from App.jsx (the web frontend)
            QString js = R"js(
                var style = document.createElement('style');
                style.type = 'text/css';
                
                /* This CSS targets the opaque background classes
                   from App.jsx and makes them semi-transparent,
                   creating the acrylic effect using the site's
                   own colors.
                */
                var css = '/* Make root transparent */' +
                          'body, html {' +
                          '  background-color: transparent !important;' +
                          '  background: transparent !important;' +
                          '}' +
                          
                          '/* This is the main page background */' +
                          '.dark .dark\\:bg-zinc-900 {' +
                          '  background-color: rgb(24 24 27 / 0.85) !important;' +
                          '}' +
                          '.bg-white {' +
                          '  background-color: rgb(255 255 255 / 0.85) !important;' +
                          '}' +

                          '/* This is the header (already 80% transparent) */' +
                          '/* We leave it alone so we don\'t break it! */' +
                          '.dark .dark\\:bg-zinc-900\\/80, .bg-white\\/80 {' +
                          '  /* No changes needed! */' +
                          '}';
                
                style.innerHTML = css;
                document.head.appendChild(style);
            )js";
            
            webView->page()->runJavaScript(js);
        }
    });

    mainWindow.setCentralWidget(webView);

    webView->load(QUrl("https://translator.my-uam.com"));

    mainWindow.show();

    return app.exec();
}
