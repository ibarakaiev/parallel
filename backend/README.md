# Parallel Backend

A FastAPI backend for the Parallel application that uses Anthropic's Claude AI model.

## Setup

1. Create a virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

or

```bash
micromamba create -n parallel
micromamba activate parallel
micromamba install -c conda-forge pip
pip install -r requirements.txt
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Set up environment variables with direnv:

Create a `.envrc` file in the backend directory by copying the `.envrc.example` file:

```bash
cp .envrc.example .envrc
```

Then edit the `.envrc` file to add your Anthropic API key:

```
export ANTHROPIC_API_KEY="your_anthropic_api_key_here"
```

Allow the direnv configuration:

```bash
direnv allow
```

You can get an API key from the [Anthropic Console](https://console.anthropic.com/).

Note: If you don't have direnv installed, install it with:
```bash
# macOS with Homebrew
brew install direnv

# Ubuntu/Debian
sudo apt-get install direnv

# Then add to your shell (bash, zsh, etc.)
# Add `eval "$(direnv hook bash)"` to your .bashrc or equivalent
```

4. Run the development server:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 4000 --reload
```

The API will be available at http://localhost:4000

## API Endpoints

### POST /chat_completion

Sends a conversation to the Claude AI model and returns the AI's response.

**Request Body:**

```json
{
  "messages": [
    {"role": "user", "content": "Hello, how are you?"},
    {"role": "assistant", "content": "I'm doing well! How can I help you today?"},
    {"role": "user", "content": "Tell me about yourself."}
  ]
}
```

**Response:**

```json
{
  "response": "I'm Claude, an AI assistant created by Anthropic to be helpful, harmless, and honest..."
}
```

## API Documentation

FastAPI automatically generates documentation:

- Swagger UI: http://localhost:4000/docs
- ReDoc: http://localhost:4000/redoc

