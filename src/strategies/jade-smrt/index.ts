import { subgraphRequest } from '../../utils';
import fetch from 'cross-fetch';
import { Multicaller, call, getProvider } from '../../utils';
import { formatUnits } from '@ethersproject/units';

export const author = 'drgorillamd';
export const version = '1.0.0';

const avaxGraph = 'https://api.thegraph.com/subgraphs/name/elkfinance/avax-blocks';

const abi = [
  'function balanceOf(address account) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)'
];

export async function strategy(
  space,
  network,
  provider,
  addresses,
  options,
  snapshot
) {

  const blockTag = typeof snapshot === 'number' ? snapshot : 'latest';
  const block = await provider.getBlock(blockTag);
  const timestamp = block.timestamp;

  const avaxBlockTag = await getAvaxBlockTag(timestamp);

  const jadePrice = await geckoPrice(options.JADE.address, timestamp, 'binance-smart-chain');
  const smrtPrice = await geckoPrice(options.SMRT.address, timestamp, 'avalanche');
  const smrtRPrice = await geckoPrice(options.SMRTR.address, timestamp, 'avalanche');

  //BSC balances:
  const multiBsc = new Multicaller(network, provider, abi, { blockTag });

  addresses.forEach((address) => {
    multiBsc.call(address+"-jade", options.JADE.address, 'balanceOf', [address]);
    multiBsc.call(address+"-sjade", options.SJADE.address, 'balanceOf', [address]);
  });

  const resBsc = await multiBsc.execute();

  // Avax balances:
  const multiAvax = new Multicaller('43114', getProvider('43114'), abi, { blockTag: avaxBlockTag });

  addresses.forEach((address) => {
    multiAvax.call(address+"-smrt", options.SMRT.address, 'balanceOf', [address]);
    multiAvax.call(address+"-smrtR", options.SMRTR.address, 'balanceOf', [address]);
    multiAvax.call(address+"-smrtRLp", options.SMRTRLP.address, 'balanceOf', [address])
  });

  // Avax SMRTR/WAVAX pool SMRTR balance and LP token total supply

  const LPBalance = await call(getProvider('43114'), abi, [options.SMRTR.address, 'balanceOf', [options.SMRTRLP.address]]);
  const LPSupply =  await call(getProvider('43114'), abi, [options.SMRTRLP.address, 'totalSupply', []]);

  const resAvax = await multiAvax.execute();

  //const smrtRWeight = smrtRPrice / jadePrice;
  //const smrtWeight = smrtPrice / jadePrice;

  return Object.fromEntries(
    addresses.map( (adr) => {
      let bal = parseFloat(formatUnits(resBsc[adr+"-jade"], options.JADE.decimals));
      bal += parseFloat(formatUnits(resBsc[adr+"-sjade"], options.SJADE.decimals));

      // SMRT balance * SMRT price/JADE price
      bal += parseFloat(formatUnits(
        resAvax[adr+"-smrt"]*smrtPrice / jadePrice
        , options.SMRT.decimals));

      // SMRTR balance * SMRTR price/JADE price
      bal += parseFloat(formatUnits(
        resAvax[adr+"-smrtR"]*smrtRPrice / jadePrice
        , options.SMRTR.decimals));

      // LP token held * smrtr pool balance / LP token total supply
      bal += parseFloat(formatUnits(
        resAvax[adr+"-smrtRLp"].mul(LPBalance).div(LPSupply)
        , options.SMRTR.decimals));

      return [adr, bal];
    })
  );             
}

async function getAvaxBlockTag(
  timestamp: number,
): Promise<number> {
  const query = {
    blocks: {
      __args: {
        first: 1,
        orderBy: 'number',
        orderDirection: 'desc',
        where: {
          timestamp_lte: timestamp
        }
      },
      number: true,
      timestamp: true
    }
  };
  const data = await subgraphRequest(avaxGraph, query);
  return Number(data.blocks[0].number);
}

async function geckoPrice(address, timestamp, chain): Promise<number> {
  const coingeckoApiURL = `https://api.coingecko.com/api/v3/coins/${chain}/contract/${address}/market_chart/range?vs_currency=usd&from=${
    timestamp - 100000
  }&to=${timestamp}`;
  const coingeckoData = await fetch(coingeckoApiURL)
    .then(async (r) => {
      const json = await r.json();
      return json;
    })
    .catch((e) => {
      console.error(e);
      throw new Error('jade-smrt:coingecko api failed');
    });

    return coingeckoData.prices?.pop()?.pop() || 0;
}