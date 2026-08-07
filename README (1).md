# HotelBot — Agent WhatsApp pour Hotel

Agent conversationnel connecte a WhatsApp Business avec dashboard d'administration, scoring de leads, et moteur d'offres base sur les disponibilites. **LLM-agnostique** — compatible OpenAI, Groq, DeepSeek, Mistral, Together AI, et modeles locaux.

## Installation

```bash
npm install
cp .env.example .env
# Editez .env avec vos cles API
npx prisma migrate dev --name init
npm run dev
```

## Configuration LLM

Le projet supporte plusieurs fournisseurs LLM. Configurez `LLM_PROVIDER` dans `.env` :

| Fournisseur | Variable | Cle API necessaire | Cout indicatif |
|---|---|---|---|
| OpenAI | `openai` | `OPENAI_API_KEY` | $$ |
| Groq | `groq` | `GROQ_API_KEY` | $ (gratuit tier dispo) |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | $ (deepseek-v4-pro) |
| Mistral | `mistral` | `MISTRAL_API_KEY` | $ |
| Together AI | `together` | `TOGETHER_API_KEY` | $ |
| Local (LM Studio/Ollama) | `local` | `LOCAL_LLM_API_KEY` | Gratuit |

Exemple avec Groq (moins cher) :
```env
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
```

## Configuration WhatsApp Cloud API

### 1. Creer une application Meta
- Allez sur [developers.facebook.com](https://developers.facebook.com)
- Creez une app avec le cas d'usage **"Tisser des liens avec votre clientele via WhatsApp"**
- Generez un token permanent (System User) avec les permissions :
  - `business_management`
  - `whatsapp_business_messaging`
  - `whatsapp_business_management`

### 2. Configurer le webhook
- Dans le dashboard Meta, configurez l'URL de callback : `https://votredomaine.com/webhook`
- Le `verify_token` doit correspondre a `WHATSAPP_VERIFY_TOKEN` dans votre `.env`
- Abonnez-vous aux champs : **messages**

### 3. Variables d'environnement
```env
WHATSAPP_ACCESS_TOKEN="EAA..."      # Token permanent
WHATSAPP_PHONE_NUMBER_ID="123..."   # ID du numero de telephone
WHATSAPP_VERIFY_TOKEN="my_token"    # Token de verification webhook
```

### Types de messages supportes
Le webhook gere automatiquement :
- **Texte** — messages standards
- **Interactifs** — boutons, listes (reponses aux choix)
- **Localisation** — coordonnees GPS partagees
- **Images, Videos, Audio, Documents** — avec legende si presente
- **Contacts** — cartes de contact partagees
- **Stickers** — notifies comme non traites
- **Reactions** — emojis sur les messages

L'agent repond de maniere adaptee a chaque type (demande de precisions pour les medias, etc.).

## Endpoints

### Webhook WhatsApp
- `GET /webhook` — Verification Meta
- `POST /webhook` — Reception des messages + statuts (sent, delivered, read, failed)

### API Admin (JSON)
- `GET /admin/leads` — Liste des leads (avec filtres `?status=hot&minScore=50&search=nom`)
- `GET /admin/leads/:id` — Detail d'un lead
- `PATCH /admin/leads/:id` — Mise a jour statut
- `GET /admin/stats` — Statistiques dashboard
- `GET /admin/room-types` — Types de chambres
- `POST /admin/room-types` — Creer un type de chambre
- `GET /admin/availability` — Disponibilites (JSON)
- `POST /admin/availability` — Ajouter/Modifier une disponibilite
- `DELETE /admin/availability/:id` — Supprimer une disponibilite

### Dashboard HTML
- `GET /admin/dashboard` — Tableau de bord des leads (filtres, stats)
- `GET /admin/availability-page` — Formulaire de gestion des disponibilites
- `GET /admin/lead-detail/:id` — Fiche detaillee d'un lead

Tous les endpoints `/admin` requierent le header `x-api-key` avec la valeur de `ADMIN_API_KEY`.

### Sante
- `GET /health` — Etat du serveur

## Modele de donnees

- **Lead** — Client WhatsApp (score, statut, budget, dates, langue)
- **Message** — Historique conversationnel
- **Offer** — Offres generees
- **LeadEvent** — Evenements (escalade, etc.)
- **RoomType** — Types de chambres
- **RoomAvailability** — Disponibilites par date

## Scoring

Score de 0 a 100 base sur : intention, dates, budget, nombre de personnes, delai de reponse, type de chambre.

- **Chaud** >= 80
- **Tiede** >= 50
- **Froid** < 50

## Structure du projet

```
src/
├── server.ts          # Serveur Express + webhook WhatsApp
├── agent.ts           # Orchestrateur LLM (analyse et reponse)
├── availability.ts    # Gestion des disponibilites
├── db.ts              # Client Prisma
├── leadScoring.ts     # Algorithme de scoring
├── offerEngine.ts     # Moteur de generation d'offres
├── whatsapp.ts        # Client WhatsApp Cloud API (multi-types)
├── llm/
│   ├── index.ts       # Factory LLM (provider-agnostic)
│   ├── types.ts       # Interfaces LLM
│   └── providers/
│       └── openai-compatible.ts  # Provider OpenAI-compatible generique
└── routes/
    └── admin.ts       # Routes admin (API + Dashboard HTML + Formulaires)
```
