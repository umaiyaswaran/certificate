# Microsoft AI Club Certificate Generator

Premium JavaScript certificate workflow for Meenakshi Sundararajan Engineering College. The application uses MongoDB Atlas database `certificate_generator` only. It never selects or accesses the existing `ticket_booking` database.

## Setup

1. Copy `.env.example` to `.env` and add the Atlas URI. The local `.env` is ignored by Git.
2. Generate a bcrypt password hash:

```powershell
node -e "console.log(require('bcryptjs').hashSync('replace-with-a-strong-password', 12))"
```

Put the result in `ADMIN_PASSWORD_HASH`. Set a long random `JWT_SECRET` before deployment.

## Run locally

```powershell
npm install --prefix frontend
npm install --prefix backend
npm run backend
npm run dev
```

Open http://localhost:5173. API documentation is available at http://localhost:8000/docs.

## MongoDB

Create or authorize the Atlas user for the supplied cluster, then keep `MONGODB_DATABASE=certificate_generator`. The backend creates only these collections and indexes in that database: `admin`, `settings`, `events`, `participants`, `signatories`, and `certificates`.

## Product paths

- React client: `frontend/src/App.tsx` and `frontend/src/styles.css`
- Express service and PDF renderer: `backend/server.js`
- Local generated files: `backend/storage/`
- Certificate IDs use `MICROAI-YYYY-NNNN` and QR verification URLs use `BASE_URL`.

Certificate PDFs are generated directly by Node.js/PDFKit in A4 landscape; no Python service is required. For production, serve the built frontend behind HTTPS, run the Express server behind a process manager, set a production `BASE_URL`, use a strong JWT secret, restrict CORS to the deployed frontend origin, and move `backend/storage` to object storage with the same path abstraction.