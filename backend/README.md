# Parallel Backend

A FastAPI backend for the Parallel application.

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
pip install requirements.txt
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Run the development server:

```bash
uvicorn app.main:app --reload
```

The API will be available at http://127.0.0.1:8000

## API Documentation

FastAPI automatically generates documentation:

- Swagger UI: http://127.0.0.1:8000/docs
- ReDoc: http://127.0.0.1:8000/redoc

