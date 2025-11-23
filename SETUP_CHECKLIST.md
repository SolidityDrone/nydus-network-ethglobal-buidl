# JustaName Subdomain - Setup Checklist

Use this checklist to ensure everything is configured correctly.

## Prerequisites

### Backend (oasis-middleman)

- [ ] Backend is already running with JustaName service implemented
- [ ] Environment variables are configured in `oasis-middleman/.env`:
  ```env
  JUSTNAME_API_KEY=your_actual_api_key
  ENS_DOMAIN=yourdomain.eth
  PRIVATE_KEY=0x...
  PROVIDER_URL=https://eth-sepolia.g.alchemy.com/v2/...
  CHAIN_ID=11155111
  ORIGIN=http://localhost:3000
  PORT=3001
  ```
- [ ] Dependencies installed: `pnpm install`
- [ ] Backend starts without errors: `pnpm dev`
- [ ] Endpoints accessible:
  - [ ] GET http://localhost:3001/health (returns status)
  - [ ] POST http://localhost:3001/api/register (available)
  - [ ] GET http://localhost:3001/api/names (available)

### Frontend

- [ ] Create `.env.local` in `frontend/` directory:
  ```env
  NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
  NEXT_PUBLIC_ENS_DOMAIN=yourdomain.eth
  NEXT_PUBLIC_PROJECT_ID=your_reown_project_id
  ```
- [ ] Dependencies installed: `pnpm install`
- [ ] No installation errors
- [ ] `@justaname.id/sdk` is in package.json (should already be there)

## Verification Steps

### 1. Backend Verification

```bash
cd oasis-middleman
pnpm dev
```

Expected output:
```
🚀 Server is running on port 3001
📝 Environment: development
🐳 Running in Docker: No
🌐 Available endpoints:
   POST http://localhost:3001/api/register
   GET http://localhost:3001/api/names
   ...
```

Test health endpoint:
```bash
curl http://localhost:3001/health
```

Expected:
```json
{
  "status": "healthy",
  "timestamp": "...",
  "uptime": ...,
  "service": "oasis-middleman",
  "version": "1.0.0"
}
```

### 2. Frontend Verification

```bash
cd frontend
pnpm dev
```

Expected output:
```
   ▲ Next.js 15.3.1
   - Local:        http://localhost:3000
   - Environments: .env.local

 ✓ Starting...
 ✓ Ready in 2s
```

### 3. Page Access

- [ ] Navigate to: http://localhost:3000
- [ ] Home page loads correctly
- [ ] Navigate to: http://localhost:3000/subdomain
- [ ] Subdomain page loads without errors
- [ ] Check browser console for errors (should be none)

### 4. UI Verification

On the subdomain page:

- [ ] Page title: "ENS Subdomain Manager"
- [ ] Registration form is visible
- [ ] Input field for subdomain name
- [ ] Input field for description
- [ ] "Register Subdomain" button
- [ ] "Registered Subdomains" section
- [ ] "Refresh" button

### 5. Functionality Tests

#### Test 1: Availability Check
- [ ] Type "test" in subdomain field
- [ ] Wait 500ms
- [ ] See "Checking availability..." message
- [ ] See either "✓ Available" or "✗ Already taken"

#### Test 2: Validation
- [ ] Type "TEST" → should convert to "test"
- [ ] Type "test@123" → should show validation message
- [ ] Type "test-123" → should be accepted
- [ ] Leave field empty → button should be disabled

#### Test 3: Registration
- [ ] Enter unique subdomain name (e.g., "alice")
- [ ] Enter description (optional)
- [ ] Click "Register Subdomain"
- [ ] See "REGISTERING..." on button
- [ ] See success toast appear
- [ ] Form clears after success
- [ ] New subdomain appears in list

#### Test 4: Duplicate Registration
- [ ] Try to register same name again
- [ ] Should see "✗ Already taken"
- [ ] Button should be disabled
- [ ] Or see error toast if you bypass and submit

#### Test 5: List Subdomains
- [ ] Click "Refresh" button
- [ ] List updates
- [ ] Each subdomain shows:
  - [ ] Name (e.g., "alice.yourdomain.eth")
  - [ ] Description (if provided)
  - [ ] Ethereum address

### 6. Navigation Test

- [ ] Click "Home" in navbar → goes to /
- [ ] Click "Subdomain" in navbar → goes to /subdomain
- [ ] Subdomain link always visible (even without account)
- [ ] Mobile menu shows Subdomain option

### 7. Responsive Design

- [ ] Resize browser to mobile width
- [ ] Form still usable
- [ ] Buttons full-width
- [ ] Text readable
- [ ] No horizontal scroll
- [ ] Mobile menu works

### 8. Error Handling

#### Test Backend Offline
- [ ] Stop backend server
- [ ] Try to register subdomain
- [ ] Should see error message
- [ ] Should NOT crash or hang
- [ ] Error is user-friendly

#### Test Invalid Data
- [ ] Try registering with special characters
- [ ] Should be prevented by validation
- [ ] Button should be disabled

### 9. Integration Test

Full flow:
1. [ ] Start backend
2. [ ] Start frontend
3. [ ] Navigate to subdomain page
4. [ ] Register subdomain "alice"
5. [ ] See success message
6. [ ] Verify "alice" appears in list
7. [ ] Try to register "alice" again
8. [ ] Should fail with "already taken"
9. [ ] Register subdomain "bob"
10. [ ] Both "alice" and "bob" visible in list

## Troubleshooting

### Problem: Page shows blank
- Check browser console for errors
- Verify .env.local exists and has correct values
- Restart frontend dev server

### Problem: "Failed to fetch"
- Ensure backend is running on port 3001
- Check NEXT_PUBLIC_BACKEND_URL in .env.local
- Verify no CORS issues in browser console

### Problem: "Registration failed"
- Check backend logs for errors
- Verify JUSTNAME_API_KEY is valid
- Ensure PRIVATE_KEY is correct
- Check network connection

### Problem: Subdomain list empty
- Backend might not have list endpoint working
- This is expected if no subdomains registered yet
- Try registering one and see if it appears

### Problem: Availability check not working
- Check network tab for API calls
- Verify /api/names endpoint works
- Check console for JavaScript errors

## Environment Variables Reference

### Required Backend Variables
```env
JUSTNAME_API_KEY=     # From https://justaname.id
ENS_DOMAIN=           # Your ENS domain (e.g., example.eth)
PRIVATE_KEY=          # Private key for signing
PROVIDER_URL=         # Ethereum RPC URL (Sepolia)
CHAIN_ID=11155111     # Sepolia testnet
ORIGIN=http://localhost:3000
PORT=3001
```

### Required Frontend Variables
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_ENS_DOMAIN=yourdomain.eth
NEXT_PUBLIC_PROJECT_ID=  # From https://cloud.reown.com
```

## Success Criteria

All of these should be true:

✅ Backend starts without errors
✅ Frontend starts without errors
✅ Subdomain page loads successfully
✅ Can type in subdomain field
✅ Availability check works (shows ✓ or ✗)
✅ Can submit registration form
✅ Success/error toasts appear
✅ Registered subdomains show in list
✅ Refresh button works
✅ No console errors
✅ Mobile view works
✅ Navigation works

## Files to Review

If something doesn't work, check these files:

### Frontend
- `frontend/.env.local` - Environment variables
- `frontend/app/subdomain/page.tsx` - Main page
- `frontend/lib/justaname-api.ts` - API client
- `frontend/components/Navbar.tsx` - Navigation

### Backend
- `oasis-middleman/.env` - Environment variables
- `oasis-middleman/src/routes/subname.ts` - API routes
- `oasis-middleman/src/services/justaname-sdk.ts` - JustaName integration
- `oasis-middleman/src/services/subname.ts` - Business logic

## Common Issues

1. **Port conflicts**: Ensure nothing else is using port 3000 or 3001
2. **ENV variables**: Must start with `NEXT_PUBLIC_` for frontend
3. **Backend URL**: Must include `http://` protocol
4. **API Key**: Must be valid JustaName API key
5. **ENS Domain**: Must match between frontend and backend
6. **Chain ID**: Must be 11155111 (Sepolia)

## Final Verification

Run this quick test:

```bash
# Terminal 1 - Backend
cd oasis-middleman
pnpm dev

# Terminal 2 - Frontend
cd frontend
pnpm dev

# Terminal 3 - Test
curl http://localhost:3001/health
# Should return: {"status":"healthy",...}

# Browser
# Visit: http://localhost:3000/subdomain
# Try registering a subdomain
# Check for success
```

If all steps pass ✅, your integration is working correctly!

## Getting Help

If you're stuck:

1. Check the detailed docs: `frontend/SUBDOMAIN_INTEGRATION.md`
2. Review quick start: `frontend/SUBDOMAIN_QUICKSTART.md`
3. Check UI reference: `frontend/SUBDOMAIN_UI_REFERENCE.md`
4. Review implementation: `JUSTANAME_IMPLEMENTATION_SUMMARY.md`
5. Look at browser console for errors
6. Check backend logs for errors
7. Verify all environment variables are set

