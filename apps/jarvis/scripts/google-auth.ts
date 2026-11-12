/**
 * Relie l'assistant à ton compte Google (Gmail + Agenda), une seule fois.
 * À lancer sur ton ordinateur : « pnpm google-auth ». Le script ouvre une page
 * de connexion Google, puis affiche la ligne GOOGLE_REFRESH_TOKEN à copier dans .env.
 */
import { createServer } from "node:http";
import { auth } from "@googleapis/gmail";
import { loadEnvFile } from "../src/config.js";
import { GOOGLE_SCOPES } from "../src/google/client.js";

loadEnvFile();
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Renseigne d'abord GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans .env (voir README, étape Google).");
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}/callback`;
const oauth = new auth.OAuth2(clientId, clientSecret, redirectUri);
const url = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GOOGLE_SCOPES });

const server = createServer(async (req, res) => {
  const params = new URL(req.url ?? "/", redirectUri).searchParams;
  const code = params.get("code");
  if (!code) {
    res.writeHead(400).end("Pas de code reçu.");
    return;
  }
  try {
    const { tokens } = await oauth.getToken(code);
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("C'est bon ! Tu peux fermer cette page et revenir au terminal.");
    if (!tokens.refresh_token) {
      console.error("Google n'a pas renvoyé de refresh token. Retire l'accès de l'appli sur myaccount.google.com/permissions puis relance.");
    } else {
      console.log("\nAjoute cette ligne dans ton fichier .env :\n");
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    }
  } catch (error) {
    res.writeHead(500).end("Échec, regarde le terminal.");
    console.error(error);
  }
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Ouvre ce lien dans ton navigateur et connecte-toi avec ton compte Google :\n");
  console.log(`${url}\n`);
});
