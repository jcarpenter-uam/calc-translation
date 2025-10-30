#include <QApplication>
#include <QMainWindow>
#include <QWebEngineView>
#include <QUrl>
#include <QObject>
#include <QWidget>
#include <QGridLayout>
#include <QPushButton>
#include <QMouseEvent>
#include <QPoint>

class CustomMainWindow : public QMainWindow
{
    Q_OBJECT

public:
    CustomMainWindow(QWidget *parent = nullptr) : QMainWindow(parent)
    {
        setWindowFlags(Qt::FramelessWindowHint | Qt::Window);
        setAttribute(Qt::WA_TranslucentBackground);
        setStyleSheet("background-color: transparent;");

        QWidget *centralContainer = new QWidget(this);
        QGridLayout *overlayLayout = new QGridLayout(centralContainer);
        overlayLayout->setContentsMargins(0, 0, 0, 0);

        m_webView = new QWebEngineView(centralContainer);
        m_webView->setAttribute(Qt::WA_TranslucentBackground);
        m_webView->setAutoFillBackground(false);
        m_webView->page()->setBackgroundColor(Qt::transparent);
        
        overlayLayout->addWidget(m_webView, 0, 0);

        QWidget *toolbar = new QWidget(centralContainer);
        toolbar->setAttribute(Qt::WA_TranslucentBackground);
        
        toolbar->setAttribute(Qt::WA_TransparentForMouseEvents);

        QHBoxLayout *toolbarLayout = new QHBoxLayout(toolbar);

        QPushButton *minimizeButton = new QPushButton("—");
        QPushButton *maximizeButton = new QPushButton("☐");
        QPushButton *closeButton = new QPushButton("✕");

        minimizeButton->setAttribute(Qt::WA_TransparentForMouseEvents, false);
        maximizeButton->setAttribute(Qt::WA_TransparentForMouseEvents, false);
        closeButton->setAttribute(Qt::WA_TransparentForMouseEvents, false);

        QString buttonStyle = R"(
            QPushButton {
                background-color: rgba(50, 50, 50, 0.4);
                color: white;
                border: none;
                padding: 8px 12px;
                font-weight: bold;
                font-size: 14px;
            }
            QPushButton:hover {
                background-color: rgba(80, 80, 80, 0.7);
            }
            QPushButton:pressed {
                background-color: rgba(100, 100, 100, 0.8);
            }
        )";
        minimizeButton->setStyleSheet(buttonStyle);
        maximizeButton->setStyleSheet(buttonStyle);
        closeButton->setStyleSheet(buttonStyle + 
            "QPushButton:hover { background-color: rgba(232, 17, 35, 0.8); }");

        toolbarLayout->addStretch();
        toolbarLayout->addWidget(minimizeButton);
        toolbarLayout->addWidget(maximizeButton);
        toolbarLayout->addWidget(closeButton);
        toolbarLayout->setContentsMargins(0, 5, 5, 0);

        overlayLayout->addWidget(toolbar, 0, 0, Qt::AlignTop | Qt::AlignRight);

        setCentralWidget(centralContainer);

        connect(closeButton, &QPushButton::clicked, this, &CustomMainWindow::close);
        connect(minimizeButton, &QPushButton::clicked, this, &CustomMainWindow::showMinimized);
        connect(maximizeButton, &QPushButton::clicked, this, [this]() {
            if (isMaximized()) {
                showNormal();
            } else {
                showMaximized();
            }
        });

        connect(m_webView, &QWebEngineView::loadFinished, [=](bool ok) {
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
                
                m_webView->page()->runJavaScript(js);
            }
        });
    }

    void loadUrl(const QUrl &url)
    {
        m_webView->load(url);
    }

protected:
    void mousePressEvent(QMouseEvent *event) override
    {
        if (event->button() == Qt::LeftButton && event->pos().y() < 50) {
            QWidget* child = childAt(event->pos());
            if (!dynamic_cast<QPushButton*>(child)) {
                m_dragPosition = event->globalPosition().toPoint() - frameGeometry().topLeft();
                event->accept();
            }
        }
    }

    void mouseMoveEvent(QMouseEvent *event) override
    {
        if (event->buttons() & Qt::LeftButton) {
            if (!m_dragPosition.isNull()) {
                move(event->globalPosition().toPoint() - m_dragPosition);
                event->accept();
            }
        }
    }

    void mouseReleaseEvent(QMouseEvent *event) override
    {
        m_dragPosition = QPoint();
        event->accept();
    }


private:
    QPoint m_dragPosition;
    QWebEngineView *m_webView;
};

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);

    CustomMainWindow mainWindow;
    mainWindow.setWindowTitle("Translucent Web Widget");
    mainWindow.resize(800, 300);

    mainWindow.loadUrl(QUrl("https://translator.my-uam.com"));

    mainWindow.show();

    return app.exec();
}

#include "main.moc"
