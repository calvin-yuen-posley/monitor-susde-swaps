# sUSDe Swap Monitor

A focused monitor for tracking sUSDe swap activities on Fluid DEX with real-time price impact analysis and CSV logging.

## Features

- 🎯 **Real-time Swap Monitoring**: Detects swap activities on sUSDe pools
- 📊 **Price Impact Analysis**: Tracks price changes before and after swaps
- 📈 **CSV Logging**: Logs all price data and events to CSV files
- 🔄 **Periodic Price Checks**: Regular price monitoring every 30 seconds
- 💰 **Large Transaction Filtering**: Focuses on significant swaps and liquidity changes
- 🎧 **Event Listeners**: Multiple event detection methods for comprehensive monitoring

## Setup

### Prerequisites

- Node.js 16.0.0 or higher
- npm package manager

### Installation

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root with your Ethereum mainnet RPC URL:

```bash
# Copy the example and add your RPC URL
cp .env.example .env
```

Edit `.env` and add your RPC URL:

```
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY_HERE
```

You can get a free RPC URL from:

- [Alchemy](https://www.alchemy.com/)
- [Infura](https://infura.io/)
- [QuickNode](https://www.quicknode.com/)
- [Ankr](https://www.ankr.com/)

### Running the Monitor

```bash
# Start the monitor
npm start

# Or run directly
node monitor-susde-swaps.js
```

## What It Monitors

The monitor tracks sUSDe pools on Fluid DEX:

- **sUSDe/USDT** pool
- **GHO/sUSDe** pool

### Events Tracked

1. **Swap Events**: Real-time swap detection via LogOperate events
2. **Large Deposits**: Deposits > $10,000
3. **Large Withdrawals**: Withdrawals > $10,000
4. **Price Changes**: Any price movement > 0.001%

### Output Files

- `susde_price_history.csv`: Comprehensive price and event logging

## CSV Log Format

The CSV file includes:

- `timestamp`: Unix timestamp
- `datetime`: ISO datetime string
- `susde_usdt_price`: sUSDe price in USDT pool
- `gho_susde_price`: sUSDe price in GHO pool
- `susde_official_price`: Official sUSDe price from contract
- `event_type`: Type of event (swap, deposit, periodic, etc.)
- `pool_affected`: Which pool was affected
- `notes`: Additional event details

## Stopping the Monitor

Press `Ctrl+C` to gracefully stop the monitor.

## Contract Addresses

- **sUSDe Token**: `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497`
- **Liquidity Layer**: `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497`
- **DEX Reserves Resolver**: `0xC93876C0EEd99645DD53937b25433e311881A27C`

## Railway Deployment

This project is configured for easy deployment to Railway:

### Prerequisites

- Railway account (free at [railway.app](https://railway.app))
- GitHub repository with your code

### Deployment Steps

1. **Connect to Railway**:

   - Go to [railway.app](https://railway.app)
   - Sign in with GitHub
   - Click "New Project" → "Deploy from GitHub repo"

2. **Configure Environment Variables**:

   - In Railway dashboard, go to your project
   - Click on "Variables" tab
   - Add: `MAINNET_RPC_URL` with your Ethereum RPC URL

3. **Deploy**:
   - Railway will automatically detect it's a Node.js project
   - It will run `npm install` and then `npm start`
   - Your monitor will start running in the cloud

### Railway Configuration

The project includes:

- `railway.json`: Railway-specific configuration
- Automatic restart on failure
- Optimized for long-running processes

### Important Notes for Railway

- **Persistent Storage**: CSV files will be lost on redeployment. Consider using Railway's persistent volumes or external storage for long-term data.
- **Environment Variables**: Make sure to set `MAINNET_RPC_URL` in Railway's environment variables.
- **Logs**: Check Railway's logs tab to monitor your application.

## License

MIT
