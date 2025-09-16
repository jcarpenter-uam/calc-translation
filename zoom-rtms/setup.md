# Download NGROK

Since this server is not publicly accessable for Zoom OAUTH callbacks we use ngrok for a temp public endpoint

Using this command after install will act as a reverse proxy to your zoom server on your local machine, be sure the port matches that servers port

```bash
ngrok http 8080
```

Visit the URL after starting the server and copy the endpoint url to change your Zoom app endpoints within the zoom app dev portal

# Get .env variables after creating your zoom app

```bash
cp .env.example .env
```

Replace with your creds
