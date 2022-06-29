const ecc = require('tiny-secp256k1')
const { BIP32Factory } = require('bip32')
const bip32 = BIP32Factory(ecc)
const bip39 = require('bip39');
const bitcoin = require('bitcoinjs-lib');
const fs = require('fs')
const { MNEMONIC } = require("../secret.json");
const CronJob = require('cron').CronJob;
const axios = require("axios");
const bitcore = require("bitcore-lib");

//Derivation path of BTC testnet
const str = "m/44'/1'/0'/0/";
var network = bitcoin.networks.testnet;
const seed = bip39.mnemonicToSeedSync(MNEMONIC);
const root3 = bip32.fromSeed(seed, network);

jsonReader("./addCount.json", (err, add) => {
    if (err) {
      console.log("Error reading file:", err);
      return;
    }
    else{  
      //For the first time, generate 0th index address and then generate receiving address
      if (!add.count && !add.zerothAddress)
        {
          add.count=0;
          var s = str + add.count;
          const child = root3.derivePath(s);
          const address = bitcoin.payments.p2pkh({ pubkey: child.publicKey, network }).address;
          console.log('zeroth Address', address)
          add.zerothAddress = address;
        }
       
        // increase address count by 1 and generate receiving address
        add.count += 1;
        var s = str + add.count;
        const Rchild = root3.derivePath(s);
        const Raddress = bitcoin.payments.p2pkh({ pubkey: Rchild.publicKey, network }).address;
        console.log('New Receiving Address', Raddress)

        //update address count and zeroth address in json  
        const jsonString = JSON.stringify(add)
              fs.writeFile('./addCount.json', jsonString, err => {
                  if (err) {
                      console.log('Error writing file', err)
                  } else {
                      console.log('Successfully wrote file')
                  }
              });

        //The job will moniter the newly generated address
          var task = new CronJob('* * * * *', () =>  {
          console.log('will execute until fund received to address - ',Raddress);
                
          const sochain_network = "BTCTEST";
          const sourceAddress = Raddress;
          let totalAmountAvailable = 0;
          let inputs = [];
          let utxo = {};
          let inputCount = 0;
          let outputCount = 1;

          //Get the unspent amount of the new address
          const res = axios.get(
              `https://sochain.com/api/v2/get_tx_unspent/${sochain_network}/${sourceAddress}`
            );
          res.then(utxos => {          
          //if there is unspent amount then stop the job and send the bitcoin to the 0th index address
            if (utxos.data.data.txs.length){
                                                   
              //Get the transaction details 
              utxos.data.data.txs.forEach(async (element) => {
                
                  utxo.satoshis = Math.floor(Number(element.value) * 100000000);
                  
                  utxo.script = element.script_hex;
                  utxo.address = utxos.data.data.address;
                  utxo.txId = element.txid;
                  utxo.outputIndex = element.output_no;
                  totalAmountAvailable += utxo.satoshis;
                  inputCount += 1;
                  inputs.push(utxo);
              });
            
              const transaction = new bitcore.Transaction();
      
              //Set transaction input
              transaction.from(inputs);
      
              //Extimate fees for the transaction
              let fee = 0;
              const resfee = axios.get(
                `https://bitcoinfees.earn.com/api/v1/fees/recommended`
              );
              resfee.then(RF => {fee =  RF.data.hourFee});
              
              //Calculate the transaction size and multiple it with the estimated fee
              
              transactionSize = inputCount * 180 + outputCount * 34 + 10;
              var tranfee = (transactionSize / 1024) * fee;
              tranfee = tranfee.toFixed(8);
                
              //Calculate the bitcoin amount to send to oth index address 
              satoshiToSend = totalAmountAvailable - tranfee;

              // set the recieving address as 0th address and the amount to send
              transaction.to(add.zerothAddress, satoshiToSend);
      
              //Set the private of key of new receiving address         
              transaction.sign(Rchild.privateKey);
      
              // serialize Transactions
              const serializedTransaction = transaction.serialize();
              // Send transaction
              const result = axios({
                  method: "POST",
                  url: `https://sochain.com/api/v2/send_tx/${sochain_network}`,
                  data: {
                  tx_hex: serializedTransaction,
                  },
              });
              
              //Stop the job once transaction is submitted
              result.then(R => { task.stop();  });
            }
          });         
          });

          //Start the job to listen for new input transaction
            task.start();
      
                    
        }
        
  });

//Function to read the json file
function jsonReader(filePath, cb) {
    fs.readFile(filePath, (err, fileData) => {
      if (err) {
        return cb && cb(err);
      }
      try {
        const object = JSON.parse(fileData);
        return cb && cb(null, object);
      } catch (err) {
        return cb && cb(err);
      }
    });
  }

  
