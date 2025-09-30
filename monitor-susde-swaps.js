#!/usr/bin/env node

// Focused sUSDe Swap Monitor for Fluid DEX with CSV Logging
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const SUSDE_ADDRESS = '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497';

const CONTRACTS = {
    mainnet: {
        liquidityLayer: '0x52Aa899454998Be5b000Ad077a46Bbe360F4e497',
        dexReservesResolver: '0xC93876C0EEd99645DD53937b25433e311881A27C'
    }
};

// ABIs
const RESOLVER_ABI = [
    {
        "inputs": [],
        "name": "getAllPoolAddresses",
        "outputs": [{"internalType": "address[]", "name": "pools_", "type": "address[]"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "pool_", "type": "address"}],
        "name": "getPoolTokens",
        "outputs": [
            {"internalType": "address", "name": "token0_", "type": "address"},
            {"internalType": "address", "name": "token1_", "type": "address"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "dex_", "type": "address"}],
        "name": "getDexCollateralReservesAdjusted",
        "outputs": [
            {
                "components": [
                    {"internalType": "uint256", "name": "token0RealReserves", "type": "uint256"},
                    {"internalType": "uint256", "name": "token1RealReserves", "type": "uint256"},
                    {"internalType": "uint256", "name": "token0ImaginaryReserves", "type": "uint256"},
                    {"internalType": "uint256", "name": "token1ImaginaryReserves", "type": "uint256"}
                ],
                "internalType": "struct IFluidDexT1.CollateralReserves",
                "name": "reserves_",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];

// Official Fluid DEX ABI (from FluidDexT1.json)
const POOL_ABI = [
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
            {"indexed": false, "internalType": "bool", "name": "swap0to1", "type": "bool"},
            {"indexed": false, "internalType": "uint256", "name": "amountIn", "type": "uint256"},
            {"indexed": false, "internalType": "uint256", "name": "amountOut", "type": "uint256"},
            {"indexed": false, "internalType": "address", "name": "to", "type": "address"}
        ],
        "name": "Swap",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
            {"indexed": false, "internalType": "uint256", "name": "sharesMinted", "type": "uint256"},
            {"indexed": false, "internalType": "uint256", "name": "token0Amount", "type": "uint256"},
            {"indexed": false, "internalType": "uint256", "name": "token1Amount", "type": "uint256"}
        ],
        "name": "Deposit",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
            {"indexed": false, "internalType": "uint256", "name": "sharesBurned", "type": "uint256"},
            {"indexed": false, "internalType": "uint256", "name": "token0Amount", "type": "uint256"},
            {"indexed": false, "internalType": "uint256", "name": "token1Amount", "type": "uint256"}
        ],
        "name": "Withdraw",
        "type": "event"
    },
    {
        "inputs": [],
        "name": "constantsView",
        "outputs": [
            {
                "components": [
                    {"internalType": "uint256", "name": "dexId", "type": "uint256"},
                    {"internalType": "address", "name": "liquidity", "type": "address"},
                    {"internalType": "address", "name": "factory", "type": "address"},
                    {"internalType": "address", "name": "token0", "type": "address"},
                    {"internalType": "address", "name": "token1", "type": "address"}
                ],
                "internalType": "struct IFluidDexT1.ConstantViews",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];

const ERC20_ABI = [
    {
        "inputs": [],
        "name": "symbol",
        "outputs": [{"internalType": "string", "name": "", "type": "string"}],
        "stateMutability": "view",
        "type": "function"
    }
];

// sUSDe Contract ABI for getting official price
const SUSDE_ABI = [
    {
        "inputs": [],
        "name": "totalAssets",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "totalSupply",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    }
];

class SusdeSwapMonitor {
    constructor() {
        this.provider = null;
        this.resolver = null;
        this.susdePools = [];
        this.lastPrices = new Map();
        this.isRunning = false;
        this.priceCheckInterval = 30000; // 30 seconds - less frequent
        
        // sUSDe contract for official price
        this.susdeContract = null;
        
        // CSV logging setup
        this.csvFilePath = path.join(__dirname, 'susde_price_history.csv');
        this.csvHeaders = ['timestamp', 'datetime', 'susde_usdt_price', 'gho_susde_price', 'susde_official_price', 'event_type', 'pool_affected', 'notes'];
        this.initializeCsvFile();
    }

    initializeCsvFile() {
        // Create CSV file with headers if it doesn't exist
        if (!fs.existsSync(this.csvFilePath)) {
            const headerRow = this.csvHeaders.join(',') + '\n';
            fs.writeFileSync(this.csvFilePath, headerRow);
            console.log(`📊 Created CSV log file: ${this.csvFilePath}`);
        } else {
            console.log(`📊 Using existing CSV log file: ${this.csvFilePath}`);
        }
    }

    async getOfficialSusdePrice() {
        try {
            const [totalAssets, totalSupply] = await Promise.all([
                this.susdeContract.totalAssets(),
                this.susdeContract.totalSupply()
            ]);
            
            if (totalSupply > 0) {
                // Calculate official price: totalAssets / totalSupply
                const officialPrice = (totalAssets * BigInt(1e18)) / totalSupply;
                return parseFloat(ethers.formatUnits(officialPrice, 18));
            }
            return null;
        } catch (error) {
            console.error('❌ Error getting official sUSDe price:', error.message);
            return null;
        }
    }

    async logPricesToCsv(eventType = 'periodic', poolAffected = 'both', notes = '') {
        try {
            const timestamp = Date.now();
            const datetime = new Date().toISOString();
            
            // Get current prices for both pools
            let susdeUsdtPrice = 'N/A';
            let ghoSusdePrice = 'N/A';
            
            for (const pool of this.susdePools) {
                const price = await this.getCurrentPrice(pool);
                if (price !== null) {
                    if (pool.pair === 'sUSDe/USDT') {
                        susdeUsdtPrice = price.toFixed(6);
                    } else if (pool.pair === 'GHO/sUSDe') {
                        ghoSusdePrice = price.toFixed(6);
                    }
                }
            }
            
            // Get official sUSDe price
            const officialPrice = await this.getOfficialSusdePrice();
            const susdeOfficialPrice = officialPrice !== null ? officialPrice.toFixed(6) : 'N/A';
            
            // Create CSV row
            const csvRow = [
                timestamp,
                datetime,
                susdeUsdtPrice,
                ghoSusdePrice,
                susdeOfficialPrice,
                eventType,
                poolAffected,
                notes.replace(/,/g, ';') // Replace commas to avoid CSV issues
            ].join(',') + '\n';
            
            // Append to CSV file
            fs.appendFileSync(this.csvFilePath, csvRow);
            
            console.log(`📊 CSV logged: ${datetime} | sUSDe/USDT: $${susdeUsdtPrice} | GHO/sUSDe: $${ghoSusdePrice} | Official: $${susdeOfficialPrice} | Event: ${eventType}`);
            
        } catch (error) {
            console.error('❌ Error logging to CSV:', error.message);
        }
    }

    async initialize() {
        console.log('🎯 Initializing sUSDe SWAP Monitor (Focused on Price Impact)');
        console.log('==========================================================');
        
        // Setup provider
        const rpcUrl = process.env.MAINNET_RPC_URL;
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        
        console.log('🔌 Connecting to blockchain...');
        const blockNumber = await this.provider.getBlockNumber();
        console.log(`✅ Connected to block ${blockNumber}`);
        
        // Initialize contracts
        this.resolver = new ethers.Contract(
            CONTRACTS.mainnet.dexReservesResolver,
            RESOLVER_ABI,
            this.provider
        );
        
        // Initialize sUSDe contract for official price
        this.susdeContract = new ethers.Contract(
            SUSDE_ADDRESS,
            SUSDE_ABI,
            this.provider
        );
        
        // Discover sUSDe pools
        await this.discoverPools();
        
        console.log(`✅ Monitor initialized with ${this.susdePools.length} sUSDe pools`);
        console.log('🎯 Focusing on SWAPS that impact sUSDe price...\n');
    }

    async discoverPools() {
        console.log('🔍 Discovering sUSDe pools...');
        
        const allPools = await this.resolver.getAllPoolAddresses();
        
        for (const poolAddress of allPools) {
            try {
                const [token0, token1] = await this.resolver.getPoolTokens(poolAddress);
                
                if (token0.toLowerCase() === SUSDE_ADDRESS.toLowerCase() || 
                    token1.toLowerCase() === SUSDE_ADDRESS.toLowerCase()) {
                    
                    const susdeIsToken0 = token0.toLowerCase() === SUSDE_ADDRESS.toLowerCase();
                    
                    // Get token symbols
                    const token0Contract = new ethers.Contract(token0, ERC20_ABI, this.provider);
                    const token1Contract = new ethers.Contract(token1, ERC20_ABI, this.provider);
                    
                    const [symbol0, symbol1] = await Promise.all([
                        token0Contract.symbol().catch(() => 'Unknown'),
                        token1Contract.symbol().catch(() => 'Unknown')
                    ]);
                    
                    const poolInfo = {
                        address: poolAddress,
                        token0, token1, symbol0, symbol1, susdeIsToken0,
                        pair: `${susdeIsToken0 ? 'sUSDe' : symbol0}/${susdeIsToken0 ? symbol1 : 'sUSDe'}`,
                        contract: new ethers.Contract(poolAddress, POOL_ABI, this.provider)
                    };
                    
                    this.susdePools.push(poolInfo);
                    console.log(`✅ Found sUSDe pool: ${poolInfo.pair} (${poolAddress})`);
                }
            } catch (error) {
                // Skip pools that can't be read
                continue;
            }
        }
    }

    async getCurrentPrice(pool) {
        try {
            const reserves = await this.resolver.getDexCollateralReservesAdjusted(pool.address);
            
            let susdePrice;
            if (pool.susdeIsToken0) {
                susdePrice = (reserves.token1ImaginaryReserves * BigInt(1e27)) / reserves.token0ImaginaryReserves;
            } else {
                susdePrice = (reserves.token0ImaginaryReserves * BigInt(1e27)) / reserves.token1ImaginaryReserves;
            }
            
            return parseFloat(ethers.formatUnits(susdePrice, 27));
        } catch (error) {
            console.error(`❌ Error getting price for ${pool.pair}:`, error.message);
            return null;
        }
    }

    async checkPriceImpact(pool, eventType = 'manual') {
        const currentPrice = await this.getCurrentPrice(pool);
        if (currentPrice === null) {
            console.log(`❌ [${new Date().toLocaleTimeString()}] Failed to get price for ${pool.pair}`);
            return null;
        }
        
        const lastPrice = this.lastPrices.get(pool.address);
        const timestamp = new Date().toLocaleTimeString();
        
        if (lastPrice !== undefined) {
            const priceChange = ((currentPrice - lastPrice) / lastPrice) * 100;
            
            // For periodic checks, always show status even if no change
            if (eventType === 'periodic') {
                if (Math.abs(priceChange) > 0.0001) { // Lower threshold: 0.0001%
                    const changeSymbol = priceChange > 0 ? '📈' : '📉';
                    const changeColor = priceChange > 0 ? '+' : '';
                    
                    console.log(`${changeSymbol} [${timestamp}] ${pool.pair} PRICE CHANGE (${eventType}):`);
                    console.log(`   💰 Price: $${currentPrice.toFixed(6)} (${changeColor}${priceChange.toFixed(6)}%)`);
                    console.log(`   📍 Pool: ${pool.address}`);
                    console.log('');
                } else {
                    // Show stable price for periodic checks
                    console.log(`⚪ [${timestamp}] ${pool.pair} STABLE: $${currentPrice.toFixed(6)} (no change)`);
                }
            } else {
                // For event-driven checks, use higher threshold
                if (Math.abs(priceChange) > 0.001) {
                    const changeSymbol = priceChange > 0 ? '📈' : '📉';
                    const changeColor = priceChange > 0 ? '+' : '';
                    
                    console.log(`${changeSymbol} [${timestamp}] ${pool.pair} PRICE IMPACT (${eventType}):`);
                    console.log(`   💰 Price: $${currentPrice.toFixed(6)} (${changeColor}${priceChange.toFixed(4)}%)`);
                    console.log(`   📍 Pool: ${pool.address}`);
                    console.log('');
                }
            }
            
            this.lastPrices.set(pool.address, currentPrice);
            return { priceChange, currentPrice };
        } else {
            // First time seeing this price
            console.log(`💎 [${timestamp}] Initial ${pool.pair} Price: $${currentPrice.toFixed(6)}`);
            console.log(`   📍 Pool: ${pool.address}`);
            console.log('');
            
            this.lastPrices.set(pool.address, currentPrice);
            return { priceChange: 0, currentPrice };
        }
    }

    setupSwapListeners() {
        console.log('🎧 Setting up event listeners (following Fluid DEX Guide)...');
        
        // 1. Listen to LogOperate events at Liquidity Layer (as per guide)
        console.log('🎧 Setting up LogOperate listener at Liquidity Layer...');
        
        // Liquidity Layer ABI for LogOperate events
        const LIQUIDITY_ABI = [
            {
                "anonymous": false,
                "inputs": [
                    {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
                    {"indexed": true, "internalType": "address", "name": "token", "type": "address"},
                    {"indexed": false, "internalType": "int256", "name": "supplyAmount", "type": "int256"},
                    {"indexed": false, "internalType": "int256", "name": "borrowAmount", "type": "int256"},
                    {"indexed": false, "internalType": "address", "name": "withdrawTo", "type": "address"},
                    {"indexed": false, "internalType": "address", "name": "borrowTo", "type": "address"},
                    {"indexed": false, "internalType": "uint256", "name": "totalAmounts", "type": "uint256"},
                    {"indexed": false, "internalType": "uint256", "name": "exchangePricesAndConfig", "type": "uint256"}
                ],
                "name": "LogOperate",
                "type": "event"
            }
        ];
        
        const liquidityLayer = new ethers.Contract(
            CONTRACTS.mainnet.liquidityLayer,
            LIQUIDITY_ABI,
            this.provider
        );
        
        // Get pool addresses for filtering
        const poolAddresses = this.susdePools.map(pool => pool.address.toLowerCase());
        console.log(`   Filtering for pool addresses: ${poolAddresses.join(', ')}`);
        
        liquidityLayer.on('LogOperate', async (user, token, supplyAmount, borrowAmount, withdrawTo, borrowTo, totalAmounts, exchangePricesAndConfig, event) => {
            const timestamp = new Date().toLocaleTimeString();
            
            // Filter by user == pool addresses (as per guide)
            if (poolAddresses.includes(user.toLowerCase())) {
                const pool = this.susdePools.find(p => p.address.toLowerCase() === user.toLowerCase());
                
                console.log(`\n🔥 [${timestamp}] SWAP ACTIVITY DETECTED via LogOperate in ${pool.pair}:`);
                console.log(`   👤 Pool (User): ${user}`);
                console.log(`   🪙 Token: ${token}`);
                console.log(`   📊 Supply Amount: ${supplyAmount.toString()}`);
                console.log(`   📊 Borrow Amount: ${borrowAmount.toString()}`);
                console.log(`   📍 Withdraw To: ${withdrawTo}`);
                console.log(`   📍 Borrow To: ${borrowTo}`);
                console.log(`   🧾 Tx: ${event.transactionHash}`);
                
                try {
                    // Format amounts for different tokens
                    const supplyFormatted = parseFloat(ethers.formatEther(supplyAmount));
                    const borrowFormatted = parseFloat(ethers.formatEther(borrowAmount));
                    
                    console.log(`   💰 Supply: ${supplyFormatted.toFixed(6)}`);
                    console.log(`   💰 Borrow: ${borrowFormatted.toFixed(6)}`);
                    
                    // Check if this is a significant operation
                    if (Math.abs(supplyFormatted) > 0.01 || Math.abs(borrowFormatted) > 0.01) {
                        console.log(`   ✅ Significant operation detected`);
                        
                        // Get price IMMEDIATELY (same block)
                        console.log(`   🔄 Getting immediate price update...`);
                        const immediateImpact = await this.checkPriceImpact(pool, 'immediate');
                        
                        // Log immediate swap impact to CSV
                        await this.logPricesToCsv('swap-immediate', pool.pair, `Swap detected: ${supplyFormatted.toFixed(2)} supply, ${borrowFormatted.toFixed(2)} borrow`);
                        
                        // Wait for next block and check again (more accurate)
                        const currentBlock = await this.provider.getBlockNumber();
                        console.log(`   ⏳ Current block: ${currentBlock}, waiting for next block...`);
                        
                        // Set up block listener for next block
                        const nextBlockHandler = async (blockNumber) => {
                            if (blockNumber > currentBlock) {
                                // Remove listener after first trigger
                                this.provider.off('block', nextBlockHandler);
                                
                                console.log(`   📦 Next block ${blockNumber} detected, getting updated price...`);
                                const nextBlockImpact = await this.checkPriceImpact(pool, 'next-block');
                                
                                // Log next block price to CSV
                                await this.logPricesToCsv('swap-next-block', pool.pair, `Post-swap price after block ${blockNumber}`);
                                
                                // Compare immediate vs next block price
                                if (immediateImpact && nextBlockImpact) {
                                    const priceDiff = nextBlockImpact.currentPrice - immediateImpact.currentPrice;
                                    const priceDiffPercent = (priceDiff / immediateImpact.currentPrice) * 100;
                                    
                                    console.log(`   📊 Price Evolution:`);
                                    console.log(`      Immediate: $${immediateImpact.currentPrice.toFixed(6)}`);
                                    console.log(`      Next Block: $${nextBlockImpact.currentPrice.toFixed(6)}`);
                                    console.log(`      Block Diff: ${priceDiffPercent > 0 ? '+' : ''}${priceDiffPercent.toFixed(6)}%`);
                                    
                                    if (Math.abs(nextBlockImpact.priceChange) > 0.001) {
                                        console.log(`   💥 Final Price Impact: ${nextBlockImpact.priceChange > 0 ? '+' : ''}${nextBlockImpact.priceChange.toFixed(4)}%`);
                                    }
                                }
                            }
                        };
                        
                        // Listen for next block
                        this.provider.on('block', nextBlockHandler);
                        
                        // Fallback timeout in case block listener fails
                        setTimeout(() => {
                            this.provider.off('block', nextBlockHandler);
                            console.log(`   ⏰ Block listener timeout, checking price anyway...`);
                            this.checkPriceImpact(pool, 'timeout-fallback');
                        }, 30000); // 30 second timeout
                        
                    } else {
                        console.log(`   ⚪ Small operation (< 0.01)`);
                    }
                    
                } catch (error) {
                    console.log(`   ❌ Error formatting amounts: ${error.message}`);
                }
                
                console.log('');
            }
        });
        
        console.log('   ✅ LogOperate listener set up at Liquidity Layer');
        
        // 2. Also listen for ANY events at each pool (as backup)
        this.susdePools.forEach((pool, index) => {
            console.log(`   Setting up generic listeners for Pool ${index + 1}: ${pool.pair} (${pool.address})`);
            
            // Test if the contract is valid
            pool.contract.constantsView().then((constants) => {
                console.log(`   ✅ Contract verified for ${pool.pair} - DexId: ${constants.dexId}`);
            }).catch((error) => {
                console.error(`   ❌ Contract verification failed for ${pool.pair}:`, error.message);
            });
            
            // Listen for ALL events at the pool (catch-all)
            console.log(`   🎧 Setting up catch-all event listener for ${pool.pair}...`);
            
            try {
                // Generic event listener for any event
                pool.contract.on('*', async (event) => {
                    const timestamp = new Date().toLocaleTimeString();
                    
                    console.log(`\n⭐ [${timestamp}] POOL EVENT DETECTED in ${pool.pair}:`);
                    console.log(`   📛 Event: ${event.event || 'Unknown'}`);
                    console.log(`   📊 Args:`, event.args);
                    console.log(`   📍 Pool: ${pool.address}`);
                    console.log(`   🧾 Tx: ${event.transactionHash}`);
                    
                    // Check for price impact after 2 seconds
                    setTimeout(async () => {
                        await this.checkPriceImpact(pool, 'pool-event');
                    }, 2000);
                    
                    console.log('');
                });
                
                console.log(`   ✅ Generic event listener set up for ${pool.pair}`);
                
            } catch (error) {
                console.error(`   ❌ Failed to set up generic listener for ${pool.pair}:`, error.message);
            }
            
            // Also listen for large liquidity changes (> $10,000)
            pool.contract.on('Deposit', async (user, sharesMinted, token0Amount, token1Amount, event) => {
                const token0Formatted = parseFloat(ethers.formatEther(token0Amount));
                const token1Formatted = parseFloat(ethers.formatEther(token1Amount));
                
                // Only log large deposits
                if (token0Formatted > 10000 || token1Formatted > 10000) {
                    const timestamp = new Date().toLocaleTimeString();
                    
                    console.log(`💰 [${timestamp}] LARGE DEPOSIT in ${pool.pair}:`);
                    console.log(`   👤 User: ${user}`);
                    console.log(`   🪙 ${pool.symbol0}: ${token0Formatted.toFixed(2)}`);
                    console.log(`   🪙 ${pool.symbol1}: ${token1Formatted.toFixed(2)}`);
                    console.log(`   📍 Pool: ${pool.address}`);
                    console.log(`   🧾 Tx: ${event.transactionHash}`);
                    
                    // Check for price impact
                    setTimeout(() => this.checkPriceImpact(pool, 'deposit'), 3000);
                    console.log('');
                }
            });
            
            pool.contract.on('Withdraw', async (user, sharesBurned, token0Amount, token1Amount, event) => {
                const token0Formatted = parseFloat(ethers.formatEther(token0Amount));
                const token1Formatted = parseFloat(ethers.formatEther(token1Amount));
                
                // Only log large withdrawals
                if (token0Formatted > 10000 || token1Formatted > 10000) {
                    const timestamp = new Date().toLocaleTimeString();
                    
                    console.log(`💸 [${timestamp}] LARGE WITHDRAWAL from ${pool.pair}:`);
                    console.log(`   👤 User: ${user}`);
                    console.log(`   🪙 ${pool.symbol0}: ${token0Formatted.toFixed(2)}`);
                    console.log(`   🪙 ${pool.symbol1}: ${token1Formatted.toFixed(2)}`);
                    console.log(`   📍 Pool: ${pool.address}`);
                    console.log(`   🧾 Tx: ${event.transactionHash}`);
                    
                    // Check for price impact
                    setTimeout(() => this.checkPriceImpact(pool, 'withdraw'), 3000);
                    console.log('');
                }
            });
        });
        
        console.log(`✅ Swap listeners setup for ${this.susdePools.length} sUSDe pools`);
        console.log('🎯 Filtering: Swaps > $100, Liquidity > $10,000');
    }

    async start() {
        await this.initialize();
        
        // Verify we found both pools
        console.log(`🔍 Discovered ${this.susdePools.length} sUSDe pools:`);
        this.susdePools.forEach((pool, index) => {
            console.log(`   ${index + 1}. ${pool.pair} - ${pool.address}`);
        });
        console.log('');
        
        // Get initial prices for ALL pools
        console.log('💎 Getting initial prices for all pools...');
        for (const pool of this.susdePools) {
            await this.checkPriceImpact(pool, 'initial');
        }
        
        // Log initial prices to CSV
        await this.logPricesToCsv('startup', 'both', 'Monitor started - initial prices');
        
        // Setup event listeners (focused on swaps)
        this.setupSwapListeners();
        
        // Setup periodic price checks (less frequent - every 30 seconds)
        setInterval(async () => {
            if (this.isRunning) {
                console.log(`🔄 [${new Date().toLocaleTimeString()}] Periodic price check for all pools...`);
                for (const pool of this.susdePools) {
                    await this.checkPriceImpact(pool, 'periodic');
                }
                
                // Log periodic prices to CSV
                await this.logPricesToCsv('periodic', 'both', 'Scheduled periodic check');
                console.log(''); // Add spacing after periodic checks
            }
        }, this.priceCheckInterval);
        
        this.isRunning = true;
        
        console.log('\n🎯 sUSDe SWAP Monitor is now running!');
        console.log(`📊 Monitoring ${this.susdePools.length} pools: ${this.susdePools.map(p => p.pair).join(', ')}`);
        console.log('🔄 Price checks every 30 seconds for ALL pools');
        console.log('🎧 Listening for real-time SWAP events on ALL pools');
        console.log('💡 Focus: Price-impacting transactions only');
        console.log('⏹️  Press Ctrl+C to stop\n');
    }

    stop() {
        this.isRunning = false;
        console.log('\n🛑 Stopping sUSDe Monitor...');
        console.log('✅ Monitor stopped');
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Start the monitor
async function main() {
    const monitor = new SusdeSwapMonitor();
    
    try {
        await monitor.start();
    } catch (error) {
        console.error('❌ Failed to start monitor:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { SusdeSwapMonitor };
