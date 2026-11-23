"""Entry point for the Airwize dashboard.

    python app.py                  # http://127.0.0.1:5000
    flask --app app run --debug    # same app, with Flask's reloader

The Go scraper must be running separately; see README.md.
"""

from webapp import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host=app.config["HOST"], port=app.config["PORT"])
