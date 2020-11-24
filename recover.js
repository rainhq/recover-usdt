

/**
 * TODO: fill out the below fields with your specific information for this recovery
 */

const address = process.env.USDT_RECOVERY_ADDRESS; // the bitgo address where the usdt is stuck
const walletPasscode = process.env.USDT_RECOVERY_WALLET_PASSCODE; // the passcode for the bitgo wallet that contains the above address
const fundingTxHex = process.env.USDT_RECOVERY_FUNDING_TX_HEX; // the transaction hex for any utxo owned by the above address - this will fund the recovery transaction
const destAddr = process.env.USDT_RECOVERY_DEST_ADDR; // the destination address where you'd like the tether sent to
const changeAddr = address; // the address where change from the transaction will be sent. recommended to leave this as is (changeAddr = address)
const tetherAmount = parseInt(process.env.USDT_RECOVERY_TETHER_AMOUNT, 10); // the amount of tether to send in the recovery transaction (1e8 = 1 usdt)
const ep1 = JSON.parse(process.env.USDT_RECOVERY_EP1); // the value of Box A of your wallet keycard - this is your encrypted user key
const ep2 = JSON.parse(process.env.USDT_RECOVERY_EP2); // the value of Box B of your wallet keycard - this is your encrypted backup key
const bitgoPublicKey = process.env.USDT_RECOVERY_BITGO_PUBLIC_KEY; // the value of Box C of your wallet keycard - this is the bitgo public key for your wallet
const addressIndex = parseInt(process.env.USDT_RECOVERY_ADDRESS_INDEX, 10); // this is the 'index' of the address being used. find this using BitGoJS and the 'wallet.getAddress({address})' function (if unsure, contact support@bitgo.com)
const addressChain = parseInt(process.env.USDT_RECOVERY_ADDRESS_CHAIN, 10); // this is the 'chain' of the address being used. find this using BitGoJS and the 'wallet.getAddress({address})' function (if unsure, contact support@bitgo.com)
const mainnet = true; // leave as true for mainnet. Set to false for testnet
/**
 * End of custom fields
 */


const bitcoin = require('bitcoinjs-lib');
const sjcl = require('sjcl');
const bip32 = require('bip32');
const Promise = require('bluebird');
const co = Promise.coroutine;
const omniSend = require('omni-simple-send');
const toBig = 100000000;
const network = mainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;

const getFundingUTXO = function(tx) {
  for (const index in tx.outs) {
    const a = bitcoin.address.fromOutputScript(tx.outs[index].script, network);
    if (a === address) {
      return {
        vout: index,
        value: tx.outs[index].value,
      };
    }
  }
  throw new Error(`The fundingTxHex does not include an output with the address ${address}`);
}

const signTx = function(pubkeys, prvs, path, scripts) {
    const inTx = bitcoin.Transaction.fromHex(fundingTxHex);
    const fundingUTXO = getFundingUTXO(inTx);
    const txInAmt = fundingUTXO.value;
    const dust = Math.round(.0000059 * toBig);
    const miningFee = Math.round(.0000122 * toBig);
    const changeAmt = Math.round(txInAmt - dust - miningFee);
    const txb = new bitcoin.TransactionBuilder(network);

    const token = 31   //USDT
    const omniData = omniSend(token, tetherAmount);
    const customOPReturn = omniData.toString('hex');
    const data = Buffer.from(customOPReturn, 'hex');
    const embed = bitcoin.payments.embed({ data: [data] });

    txb.addInput(inTx.getId(), parseInt(fundingUTXO.vout));
    txb.addOutput(destAddr, dust);
    txb.addOutput(changeAddr, changeAmt);
    txb.addOutput(embed.output, 0);

    let keyPair1 = bip32.fromBase58(prvs[0]);
    keyPair1.network = network;

    keyPair1 = keyPair1.derivePath(path);

    txb.sign(0, keyPair1, scripts.p2sh.redeem.output, null, txInAmt, scripts.p2wsh.redeem.output);

    const finalTx = txb.buildIncomplete();

    console.log(`Completed signing recovery transaction. Broadcast the following tx hex at https://${mainnet ? 'www' : 'testnet'}.smartbit.com.au/txs/pushtx : \n\n`);
    console.log(finalTx.toHex());
}

const execute = co(function *() {

    const p1 = sjcl.decrypt(walletPasscode, JSON.stringify(ep1));
    const prvs = [p1];

    const node0 = bip32.fromBase58(p1);
    const node1 = bip32.fromBase58(bitgoPublicKey);
    node0.network = network;
    node1.network = network;
    const path = `0/0/${addressChain}/${addressIndex}`;
    const child0 = node0.derivePath(path);
    const child1 = node1.derivePath(path);
    const pubkeys = [child0.publicKey, child1.publicKey];

    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network });
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });
    const p2sh = bitcoin.payments.p2sh({ redeem: p2wsh, network });

    const scripts = {
      p2wsh,
      p2sh
    };

    const result = p2sh;

    //  Had to remove address check, as the derivation of the address containing the stuck USDT no longer works without the backup key

    console.log('Got wallet data, now attempting to sign transaction...');
    signTx(pubkeys, prvs, path, scripts);

});

execute();
