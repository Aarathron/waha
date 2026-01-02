# Prerequisites
# Actions Required Before Implementation

**Version**: 1.0
**Last Updated**: January 2, 2026

This document lists all actions YOU (the user) must complete before development can begin. These are external dependencies that cannot be automated.

---

## Quick Checklist

| # | Action | Priority | Time | Status |
|---|--------|----------|------|--------|
| 1 | Install Docker Desktop | Critical | 10 min | [ ] |
| 2 | Install Node.js 20 LTS | Critical | 5 min | [ ] |
| 3 | Set up GitHub SSH key | Critical | 10 min | [ ] |
| 4 | Fork WAHA repository | Critical | 2 min | [ ] |
| 5 | Obtain test WhatsApp number | Critical | Varies | [ ] |
| 6 | Install WhatsApp on test device | Critical | 5 min | [ ] |
| 7 | Choose VPS provider | High | 15 min | [ ] |
| 8 | Set up VPS (for production) | High | 30 min | [ ] |
| 9 | Configure domain/subdomain | Medium | 15 min | [ ] |
| 10 | Set up monitoring account | Low | 10 min | [ ] |

**Total Estimated Time**: ~2 hours

---

## 1. Development Environment

### 1.1 Install Docker Desktop

**Why**: WAHA runs in Docker containers. We need Docker for local development and production.

**Steps**:
1. Download from https://www.docker.com/products/docker-desktop/
2. Install for your OS (Windows/Mac/Linux)
3. Start Docker Desktop
4. Verify installation:
   ```bash
   docker --version
   # Expected: Docker version 24.x.x or higher

   docker run hello-world
   # Expected: "Hello from Docker!" message
   ```

**Troubleshooting**:
- **Windows**: Enable WSL2 if prompted
- **Linux**: Add your user to docker group: `sudo usermod -aG docker $USER`
- **Mac M1/M2**: Use Docker Desktop for Apple Silicon

**Status**: [ ] Not Started / [ ] In Progress / [ ] Completed

---

### 1.2 Install Node.js 20 LTS

**Why**: WAHA is built with Node.js/NestJS. We need Node.js for local development.

**Steps**:
1. **Recommended**: Use nvm (Node Version Manager)
   ```bash
   # Install nvm (Linux/Mac)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

   # Install Node.js 20
   nvm install 20
   nvm use 20
   ```

2. **Alternative**: Direct download from https://nodejs.org/

3. Verify installation:
   ```bash
   node --version
   # Expected: v20.x.x

   npm --version
   # Expected: 10.x.x
   ```

4. Install pnpm (optional but recommended):
   ```bash
   npm install -g pnpm
   pnpm --version
   # Expected: 8.x.x or higher
   ```

**Status**: [ ] Not Started / [ ] In Progress / [ ] Completed

---

### 1.3 Set Up GitHub SSH Key

**Why**: Needed to clone your private fork and push changes.

**Steps**:
1. Generate SSH key (if you don't have one):
   ```bash
   ssh-keygen -t ed25519 -C "your-email@example.com"
   # Press Enter for default location
   # Enter a passphrase (recommended)
   ```

2. Start SSH agent:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```

3. Copy public key:
   ```bash
   cat ~/.ssh/id_ed25519.pub
   # Copy the output
   ```

4. Add to GitHub:
   - Go to https://github.com/settings/keys
   - Click "New SSH key"
   - Paste your public key
   - Give it a title (e.g., "Development Machine")

5. Verify:
   ```bash
   ssh -T git@github.com
   # Expected: "Hi username! You've successfully authenticated..."
   ```

**Status**: [ ] Not Started / [ ] In Progress / [ ] Completed

---

## 2. WAHA Repository

### 2.1 Fork WAHA Repository

**Why**: We need our own copy to add ban prevention features.

**Steps**:
1. Go to https://github.com/devlikeapro/waha
2. Click "Fork" button (top right)
3. Select your account as destination
4. Wait for fork to complete
5. Note your fork URL: `https://github.com/YOUR_USERNAME/waha`

**Important**: Do NOT clone yet - I will do this during implementation.

**Your Fork URL**: ________________________________

**Status**: [ ] Not Started / [ ] In Progress / [ ] Completed

---

## 3. WhatsApp Test Environment

### 3.1 Obtain Test WhatsApp Number

**Why**: We need a number for development/testing. DO NOT use your primary number during development.

**Options** (in order of recommendation):

#### Option A: Prepaid SIM Card (Recommended)
- Buy a cheap prepaid SIM card ($5-10)
- Use an old phone to activate WhatsApp
- This number can be "burned" if banned during testing

#### Option B: Virtual Number Service
**Caution**: Some virtual numbers are blocked by WhatsApp.

**Services that sometimes work**:
- TextNow (US numbers)
- Google Voice (US only, may work)
- Some local VoIP providers

**Services that usually DON'T work**:
- Most SMS verification services
- Twilio virtual numbers
- Most "free SMS" websites

#### Option C: Secondary Personal Number
- Use if you have a spare SIM card
- Only use after warmup system is fully tested

**Your Test Number**: +________________________________

**Status**: [ ] Not Started / [ ] In Progress / [ ] Completed

---

### 3.2 Install WhatsApp on Test Device

**Why**: Needed to scan QR code and verify messages.

**Steps**:
1. Install WhatsApp on a phone with your test SIM
2. Complete WhatsApp verification
3. Set up basic profile (name, photo) - important for warmup!
4. Keep this phone accessible during development

**Test Device**: ________________________________ (e.g., "Old iPhone 7")

**Status**: [ ] Not Started / [ ] In Progress / [ ] Completed

---

## 4. Production Infrastructure

### 4.1 Choose VPS Provider

**Why**: We need a server to run the WhatsApp API service.

**Recommended Providers**:

| Provider | Specs | Price | Link |
|----------|-------|-------|------|
| **Hetzner Cloud** (Recommended) | 2 vCPU, 4GB RAM | ~$7/mo | https://www.hetzner.com/cloud |
| DigitalOcean | 2 vCPU, 4GB RAM | $24/mo | https://www.digitalocean.com |
| Vultr | 2 vCPU, 4GB RAM | $24/mo | https://www.vultr.com |
| Linode | 2 vCPU, 4GB RAM | $24/mo | https://www.linode.com |
| AWS Lightsail | 2 vCPU, 4GB RAM | $20/mo | https://aws.amazon.com/lightsail |

**My Recommendation**: Hetzner Cloud (best price/performance)

**Selection Criteria**:
- [x] At least 2 vCPU
- [x] At least 4GB RAM
- [x] At least 40GB SSD
- [x] Unmetered or high bandwidth
- [x] Location close to your users

**Your Choice**: ________________________________

**Status**: [ ] Not Started / [ ] In Progress / [ ] Completed

---

### 4.2 Create VPS Instance

**Why**: This is where your production service will run.

**Skip this if**: You only want to run locally for now.

**Steps** (using Hetzner as example):
1. Create account at https://accounts.hetzner.com/signUp
2. Add payment method
3. Go to Cloud Console
4. Click "Add Server"
5. Configure:
   - **Location**: Choose closest to your users
   - **Image**: Ubuntu 22.04
   - **Type**: CX21 (2 vCPU, 4GB RAM)
   - **SSH Key**: Add your public key from step 1.3
   - **Name**: `whatsapp-api` or similar
6. Create server
7. Note the IP address

**Your VPS IP**: ________________________________

**SSH Command**: `ssh root@YOUR_IP`

**Status**: [ ] Not Started / [ ] In Progress / [ ] Completed

---

### 4.3 Configure Domain (Optional but Recommended)

**Why**: Easier to remember than IP address, required for proper SSL.

**Steps**:
1. If you have a domain, add an A record:
   - **Type**: A
   - **Name**: `api` (or `whatsapp`)
   - **Value**: Your VPS IP address
   - **TTL**: 3600

2. Wait for DNS propagation (5-30 minutes)

3. Verify:
   ```bash
   ping api.yourdomain.com
   # Should resolve to your VPS IP
   ```

**Your Domain**: ________________________________ (e.g., api.yoursite.com)

**Status**: [ ] Not Started / [ ] Skipping / [ ] Completed

---

## 5. Optional But Recommended

### 5.1 Set Up Monitoring Account

**Why**: Get alerts when your service goes down.

**Free Options**:
- **UptimeRobot** (50 monitors free): https://uptimerobot.com/
- **Better Stack** (10 monitors free): https://betterstack.com/
- **Freshping** (50 monitors free): https://www.freshworks.com/website-monitoring/

**Steps**:
1. Create free account
2. Add HTTP monitor for your API health endpoint (after deployment):
   - URL: `https://api.yourdomain.com/health`
   - Check interval: 5 minutes
3. Configure email/SMS alerts

**Status**: [ ] Not Started / [ ] Skipping / [ ] Completed

---

### 5.2 Set Up Error Tracking (Optional)

**Why**: Catch and debug errors in production.

**Free Options**:
- **Sentry** (5K events/month free): https://sentry.io/
- **LogRocket** (1K sessions/month free): https://logrocket.com/

**Status**: [ ] Not Started / [ ] Skipping / [ ] Completed

---

## 6. Security Preparations

### 6.1 Generate Secure API Key

**Why**: You'll need a strong API key for production.

**Generate**:
```bash
# Option 1: Using OpenSSL
openssl rand -hex 32

# Option 2: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Option 3: Using Python
python3 -c "import secrets; print(secrets.token_hex(32))"
```

**Your API Key**: ________________________________
(Store this securely - you'll need it during deployment)

**Status**: [ ] Not Started / [ ] In Progress / [ ] Completed

---

### 6.2 Prepare Environment Variables

**Why**: Secure configuration for deployment.

**Required Variables** (save these securely):
```env
# API Configuration
WAHA_API_KEY=your-generated-api-key-from-6.1
WHATSAPP_DEFAULT_ENGINE=NOWEB

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/waha
POSTGRES_PASSWORD=generate-strong-password

# Redis (if using)
REDIS_URL=redis://localhost:6379

# Security
NODE_ENV=production
```

**Generate Postgres Password**:
```bash
openssl rand -base64 24
```

**Your Postgres Password**: ________________________________

**Status**: [ ] Not Started / [ ] In Progress / [ ] Completed

---

## 7. Knowledge Prerequisites

### 7.1 Understand WhatsApp Risks

**Read these before proceeding**:

1. **WhatsApp Terms of Service**: https://www.whatsapp.com/legal/terms-of-service
   - Understand: Using unofficial APIs may violate ToS
   - Risk: Account bans are possible

2. **WAHA "How to Avoid Blocking"**: https://waha.devlike.pro/docs/how-to/anti-ban/
   - Understand: Warmup process
   - Understand: Rate limiting importance

3. **Ban Risk Acknowledgment**:
   - [ ] I understand WhatsApp may ban accounts using unofficial APIs
   - [ ] I will use test/burner numbers during development
   - [ ] I will follow the 21-day warmup process
   - [ ] I accept responsibility for any account bans

**Status**: [ ] Read and Understood

---

### 7.2 Backup Current WhatsApp Data

**If using a number with existing data**:

1. Open WhatsApp on phone
2. Go to Settings → Chats → Chat Backup
3. Create backup to Google Drive/iCloud
4. Note: Once connected to WAHA, WhatsApp Web sessions may be affected

**Status**: [ ] Not Applicable / [ ] Completed

---

## 8. Time Commitment

### Expected Development Time
| Phase | Duration | Your Availability |
|-------|----------|-------------------|
| Phase 1: Foundation | 5 days | ______ |
| Phase 2: Features | 5 days | ______ |
| Phase 3: Production | 5 days | ______ |
| **Total** | **~3 weeks** | |

### Ongoing Maintenance
- Check safety dashboard: 5 min/day (first month)
- Monitor for WAHA updates: 15 min/week
- Security patches: As needed

---

## 9. Verification Checklist

Before saying "Ready to start", confirm:

### Critical (Cannot proceed without these)
- [ ] Docker installed and working (`docker run hello-world`)
- [ ] Node.js 20 installed (`node --version` shows v20.x)
- [ ] GitHub SSH working (`ssh -T git@github.com` succeeds)
- [ ] WAHA forked to your GitHub account
- [ ] Test WhatsApp number ready
- [ ] WhatsApp installed on test device with profile set up

### High Priority (Needed for production)
- [ ] VPS provider chosen
- [ ] VPS created with SSH access
- [ ] Domain configured (or using IP directly)
- [ ] API key generated
- [ ] Database password generated

### Nice to Have
- [ ] Monitoring account created
- [ ] Error tracking set up

---

## 10. Ready to Start?

Once you've completed the critical items above, reply with:

```
PREREQUISITES COMPLETED:
- Docker: ✓
- Node.js: ✓
- GitHub SSH: ✓
- WAHA Fork URL: https://github.com/YOUR_USERNAME/waha
- Test WhatsApp Number: +1234567890
- Test Device: [describe device]
- VPS IP: [if applicable]
- Domain: [if applicable]

Ready to begin implementation!
```

---

## Quick Reference Commands

### Test Docker
```bash
docker --version
docker-compose --version
docker run hello-world
```

### Test Node.js
```bash
node --version
npm --version
pnpm --version  # if installed
```

### Test GitHub SSH
```bash
ssh -T git@github.com
```

### Test VPS Connection
```bash
ssh root@YOUR_VPS_IP
```

### Generate Secure Passwords
```bash
# API Key (64 hex chars)
openssl rand -hex 32

# Database Password
openssl rand -base64 24

# Webhook Secret
openssl rand -base64 32
```

---

## Troubleshooting

### Docker Issues
- **Permission denied**: Add user to docker group: `sudo usermod -aG docker $USER` then log out/in
- **Cannot start**: Ensure virtualization is enabled in BIOS
- **Slow on Windows**: Use WSL2 backend

### Node.js Issues
- **Command not found**: Restart terminal after nvm install
- **Wrong version**: Run `nvm use 20`

### SSH Issues
- **Permission denied (publickey)**: Ensure key is added to ssh-agent
- **Host key verification failed**: Remove old entry from `~/.ssh/known_hosts`

### VPS Issues
- **Cannot connect**: Check firewall allows SSH (port 22)
- **Connection timeout**: Verify IP address is correct

---

## Support Resources

- **WAHA Documentation**: https://waha.devlike.pro/docs/
- **WAHA GitHub Issues**: https://github.com/devlikeapro/waha/issues
- **Baileys Documentation**: https://whiskeysockets.github.io/Baileys/
- **NestJS Documentation**: https://docs.nestjs.com/
- **Docker Documentation**: https://docs.docker.com/

---

**Document Version**: 1.0
**Created**: January 2, 2026
**Last Updated**: January 2, 2026
