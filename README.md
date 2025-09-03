# Hairroom - AI Hairstyle with Cloudflare Workers

An [AI hairstyle changer](https://hairroom.app) application built with React and Cloudflare Workers, leveraging AI technology to provide personalized hairstyle recommendations and image generation services.

[English](README.md) | [中文](README.zh-CN.md)

## ✨ Features

- 🎨 **AI-Powered Hairstyle Generation**: Intelligent hairstyle design powered by GPT-4o and Flux Kontext
- 📱 **Responsive Design**: Optimized for both desktop and mobile devices
- 🔐 **Google OAuth Authentication**: Secure and convenient user authentication
- ☁️ **Serverless Deployment**: Built on Cloudflare Workers serverless architecture
- 💾 **Full-Stack Data Storage**: Integrated with D1 Database, R2 Object Storage, and KV Cache

## 🛠 Tech Stack

This project is built with a modern tech stack:

- **[React](https://react.dev/)**: UI framework for building user interfaces
- **[React Router v7](https://reactrouter.com/)**: Application routing and server-side API handling
- **[Cloudflare Workers](https://workers.cloudflare.com/)**: Serverless runtime environment
- **[Cloudflare D1](https://developers.cloudflare.com/d1/)**: Serverless SQL database at the edge
- **[Cloudflare R2](https://developers.cloudflare.com/r2/)**: Object storage service
- **[Cloudflare KV](https://developers.cloudflare.com/kv/)**: Key-value storage
- **[Tailwind CSS](https://tailwindcss.com/)**: Utility-first CSS framework
- **[DaisyUI](https://daisyui.com/)**: Tailwind CSS component library
- **[React OAuth](https://github.com/MomenSherif/react-oauth)**: Google OAuth authentication

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- pnpm
- Cloudflare account

### 1. Clone the Repository

```bash
git clone https://github.com/neyric/ai-hairstyle.git
cd ai-hairstyle
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Environment Setup

Copy and edit the environment variables in `wrangler.jsonc` file:

#### API Key Configuration

Get your [Kie AI](https://kie.ai) API key:

```json
{
  "vars": {
    "KIEAI_APIKEY": "your_kie_ai_api_key_here"
  }
}
```

#### Google OAuth Setup

Create OAuth 2.0 credentials in [Google Cloud Console](https://console.cloud.google.com/apis/dashboard):

```json
{
  "vars": {
    "GOOGLE_CLIENT_ID": "your_google_client_id",
    "GOOGLE_CLIENT_SECRET": "your_google_client_secret"
  }
}
```

#### Cloudflare Services Configuration

Create and configure the following Cloudflare services:

1. **D1 Database**:

```bash
wrangler d1 create hairroom
```

2. **KV Namespace**:

```bash
wrangler kv:namespace create "hairroom-kv"
```

3. **R2 Bucket**:

```bash
wrangler r2 bucket create hairroom
```

Then configure the bindings in `wrangler.jsonc`:

```json
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "hairroom",
      "database_id": "your_d1_database_id",
      "migrations_dir": "./app/.server/drizzle/migrations"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "your_kv_namespace_id"
    }
  ],
  "r2_buckets": [
    {
      "binding": "R2",
      "bucket_name": "hairroom"
    }
  ]
}
```

### 4. Database Migration

Run database migrations to create the necessary tables:

```bash
pnpm run db:migrate      # Remote database migration
pnpm run db:migrate:local # Local database migration
```

### 5. Local Development

After running `pnpm run db:migrate:local`, start the development server:

```bash
pnpm run dev
```

Navigate to [http://localhost:5173](http://localhost:5173) to view the application.

## 🌐 Deployment

### Deploy to Cloudflare Workers

```bash
pnpm run deploy
```

### Custom Domain Configuration

To bind a custom domain, uncomment and modify the following configuration in `wrangler.jsonc`:

```json
{
  "routes": [
    {
      "pattern": "your-domain.com",
      "custom_domain": true
    },
    {
      "pattern": "www.your-domain.com",
      "custom_domain": true
    }
  ]
}
```

Then redeploy:

```bash
pnpm run deploy
```

## 🔧 Available Scripts

- `pnpm run dev` - Start development server
- `pnpm run build` - Build for production
- `pnpm run deploy` - Build and deploy to Cloudflare Workers
- `pnpm run preview` - Preview production build
- `pnpm run typecheck` - Run TypeScript type checking
- `pnpm run cf-typegen` - Generate Cloudflare Workers type definitions
- `pnpm run db:generate` - Generate database migration files
- `pnpm run db:migrate` - Run database migrations
- `pnpm run db:migrate:local` - Run local database migrations

## 👨‍💼 Admin Operations

### Manual Credit Management

For administrators who need to manually add credits to user accounts, we provide several convenient tools:

#### Method 1: Quick Script (Recommended)

```bash
# Generate SQL statements for adding credits
./quick-add-credits.sh <user_email> <credits_amount> [note]

# Example: Add 500 credits to user
./quick-add-credits.sh user@example.com 500 "Manual top-up"
```

#### Method 2: Node.js Script

```bash
# Generate SQL statements using Node.js
node add-credits.js <user_email> <credits_amount> [note]

# Example
node add-credits.js user@example.com 100 "Bonus credits"
```

#### Method 3: Direct SQL Execution

Refer to the detailed guide in `manual-add-credits.md` for step-by-step instructions on executing SQL commands directly in the Cloudflare D1 console.

#### Important Notes

- **Backup First**: Always backup your database before making changes
- **Verify User**: Ensure the user email is correct to avoid crediting wrong accounts
- **Document Changes**: Use descriptive notes for audit trails
- **Access Control**: Only authorized personnel should perform these operations

For detailed instructions and troubleshooting, see the complete guide in `manual-add-credits.md`.

## 🤝 Contributing

Contributions are welcome! Please ensure you:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [OpenAI](https://openai.com/) - GPT-4o API
- [Cloudflare](https://cloudflare.com/) - Infrastructure support
- [Kie AI](https://kie.ai/) - AI service provider

## 📞 Contact

For questions or suggestions, please reach out via:

- Open an [Issue](https://github.com/neyric/ai-hairstyle/issues)

---

⭐ If this project helped you, please give it a star!
