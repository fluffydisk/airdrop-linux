'use strict';
// Phone log input is private and transient. Export closed labels and byte-sized
// status/reason fields only, never messages, peers, PIDs, payloads or codes.
const TAGS=Object.freeze(['BluetoothGatt','GattService','BtGatt.GattService','bt_stack','bt_btm','bt_l2cap','bt_btif','bluetooth','bt_hci','bt_btu','BluetoothSocket','BluetoothAdapter','NearbyMediums','NearbySharing']);
const WORDS=Object.freeze(['gatt','l2cap','rfcomm','connect','disconnect','timeout','fail','error','read','write','cancel']);
function record(line){
 if(typeof line!=='string'||Buffer.byteLength(line)>4096||/[\r\n\0]/.test(line))return null;
 const m=line.match(/^\s*(\d{9,12}\.\d{3,9})\s+(?:\d+\s+)?\d+\s+\d+\s+[VDIWEF]\s+([A-Za-z0-9._-]{1,64})\s*:\s*(.*)$/);
 if(!m||!TAGS.includes(m[2]))return null;
 const text=m[3].toLowerCase(),labels=WORDS.filter(x=>new RegExp('\\b'+x+'[a-z_]*\\b').test(text));
 const fields={};for(const key of ['status','reason']){
  const x=text.match(new RegExp('\\b'+key+'\\s*[=:]\\s*(0x[0-9a-f]{1,2}|[0-9]{1,3})\\b'));
  if(x){const n=Number(x[1]);if(n>=0&&n<=255)fields[key]=n;}
 }
 if(!labels.length&&!Object.keys(fields).length)return null;
 return {clock:'android-epoch',androidMs:Number(m[1])*1000,tag:m[2],labels,...fields};
}
module.exports={TAGS,record};
