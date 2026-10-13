---
description: Create a professional README.md adapted to the project type
---

# Add Professional README

You are an expert in technical documentation. Your mission is to create a comprehensive, professional README.md file adapted to the project type.

## Steps to Follow

### 1. Project Analysis
Analyze the project to determine:
- The project type (Laravel, React, Node.js, Python, etc.)
- Technologies used
- Main objective of the project
- Dependencies and prerequisites
- File structure

Use the following tools for analysis:
- Read configuration files (package.json, composer.json, requirements.txt, etc.)
- Examine folder structure
- Check .env.example files
- Review existing build/script files

### 2. README Generation

Create a README.md file with the following structure:

#### A. Header with Badges
- Project title (use folder name or name from configs)
- Appropriate badges by type:
  - Language/Framework
  - Version

#### B. Description
- Clear and concise description (2-3 sentences)
- Main objective of the project
- Key features (3-5 bullet points with emojis)

#### C. Prerequisites
Detailed list with versions:
- Languages (PHP, Node.js, Python, etc.)
- Database
- Required tools (Composer, npm, etc.)
- Compatible operating system

#### D. Installation
Step-by-step instructions with exact commands:
```bash
# Example structure
git clone [repo]
cd [project]
# ... other commands
```

#### E. Configuration
- Environment variables (.env)
- Configuration files to modify

#### F. Usage
- Startup commands
- Application access (URLs)
- Usage examples based on real code
- Screenshots or GIFs if relevant (leave placeholders)

#### G. Project Structure
Tree of main folders and files:
```
project/
├── src/
│   ├── components/
│   └── ...
├── public/
└── ...
```

#### H. Available Scripts
List of npm/composer/make/etc. commands with descriptions

#### I. Tests
- How to run tests
- Types of tests available

#### J. Deployment
- Deployment instructions
- Available environments
- Production configuration

## Style and Formatting

### Emojis to Use
- 📋 Table of Contents
- 🚀 Installation/Getting Started
- ⚙️ Configuration
- 💻 Usage
- 📁 Structure
- 🧪 Tests
- 🚢 Deployment
- 🤝 Contributing
- 📝 License
- 📧 Contact
- ⚡ Features
- ⚠️ Warnings
- ✅ Prerequisites
- 🔧 Development

### Code Blocks
- Always specify language (```bash, ```php, ```javascript, etc.)
- Include explanatory comments
- Use real examples from the project

### Formatting
- Use hierarchical headings (##, ###)
- Add table of contents for long READMEs
- Use bullet and numbered lists
- **Bold** important terms
- Use `inline code` for commands/variables

## Adaptations by Project Type

### Laravel
- Include important artisan commands
- Database/cache/queue configuration
- Assets compilation (Vite/Mix)
- Migrations and seeders

### React/Vue/Frontend
- Build/dev scripts
- Frontend environment variables
- API proxy
- Production build

### Node.js/Backend
- Server configuration
- Environment variables
- Database setup
- API documentation links

### Python
- Virtual environment
- Requirements.txt
- Python version configuration

## Important Points

1. **Be precise**: Use real versions, commands, and configurations from the project
2. **Be complete**: Don't miss any installation step
3. **Be clear**: Explain the why, not just the how
4. **Be visual**: Emojis and formatting for readability
5. **Be practical**: Concrete examples based on real code

## Output

Generate the complete README.md and ask the user if they want to:
- Add additional sections
- Modify certain parts
- Add screenshots/GIFs
- Customize further

Don't forget to actually analyze the project code to provide accurate and relevant information!
