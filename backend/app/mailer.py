"""The only SMTP sender (AD-19): auth emails over `aiosmtplib`, one email per connection.

Never logs a recipient address or a link: callers decide what, if anything, to log.
"""

from email.headerregistry import Address
from email.message import EmailMessage
from email.utils import parseaddr

import aiosmtplib

from app.config import Settings

# Seconds for the whole SMTP exchange before giving up.
TIMEOUT_SECONDS = 10.0

# The verification email (FR-1), as approved for EXPERIENCE.md › Strings by surface (2026-11-12).
_VERIFICATION = {
    "en": {
        "subject": "Confirm your email for Study Buddy",
        "greeting": "Hi {name},",
        "greeting_no_name": "Hi,",
        "lines": [
            "Confirm your email address by opening this link:",
            "{link}",
            "The link works for 24 hours. You can use Study Buddy without confirming; "
            "you only need it to link a Google account.",
            "If you didn't create an account, you can ignore this email.",
        ],
    },
    "nb": {
        "subject": "Bekreft e-postadressen din for Study Buddy",
        "greeting": "Hei {name},",
        "greeting_no_name": "Hei,",
        "lines": [
            "Bekreft e-postadressen din ved å åpne denne lenken:",
            "{link}",
            "Lenken gjelder i 24 timer. Du kan bruke Study Buddy uten å bekrefte; "
            "du trenger det bare for å koble til en Google-konto.",
            "Hvis du ikke har opprettet en konto, kan du se bort fra denne e-posten.",
        ],
    },
}


def verification_email(language: str | None, name: str | None, link: str) -> tuple[str, str]:
    """Return (subject, plain-text body) in `language`, falling back to English."""
    text = _VERIFICATION.get(language or "en", _VERIFICATION["en"])
    greeting = text["greeting"].format(name=name) if name else text["greeting_no_name"]
    paragraphs = [greeting, *(line.format(link=link) for line in text["lines"])]
    return text["subject"], "\n\n".join(paragraphs) + "\n"


def _from_header(value: str) -> Address:
    display_name, address = parseaddr(value)
    return Address(display_name=display_name, addr_spec=address)


async def send(settings: Settings, to: str, subject: str, body: str) -> None:
    """Send one plain-text email on its own SMTP connection. Raises on any failure."""
    message = EmailMessage()
    message["From"] = _from_header(settings.smtp_from)
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    password = settings.smtp_password.get_secret_value() if settings.smtp_password else None
    await aiosmtplib.send(
        message,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username or None,
        password=password or None,
        use_tls=settings.smtp_tls == "tls",
        start_tls=settings.smtp_tls == "starttls",
        timeout=TIMEOUT_SECONDS,
    )
