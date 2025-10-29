# Specify the Qt modules we need
# We need 'widgets' for QApplication, QMainWindow, and QLabel
QT += widgets webenginewidgets

# Set the name of the final executable
TARGET = CALC_Zoom_Translation.qt

# Add our source file to the build
SOURCES += main.cpp

# This is good practice for modern Qt (Qt 6 requires C++17)
CONFIG += c++17
