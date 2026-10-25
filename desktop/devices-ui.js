'use strict';
(()=>{
 const wizard=document.getElementById('connectionWizard');let busy=false,first=true,interfacesKey='';
 async function render(){
  try{
   const state=await window.airdrop.devices('state');
   document.getElementById('deviceStatus').textContent=state.message;
   document.getElementById('deviceStatus').dataset.status=state.status;
   const interfaces=JSON.stringify(state.interfaces);
   if(interfaces!==interfacesKey){interfacesKey=interfaces;const select=document.getElementById('lanInterface');select.replaceChildren(...state.interfaces.map(i=>{const option=document.createElement('option');option.value=i.address;option.textContent=i.name+' — '+i.address;return option;}));}
   document.getElementById('deviceLogin').hidden=!state.authURL;
   document.getElementById('deviceHttps').hidden=state.status!=='needs-https';
   const ready=state.status==='ready'&&!!state.url&&!!state.qr;
   document.getElementById('deviceLink').hidden=!ready;
   document.getElementById('deviceAddress').value=ready?state.url:'';
   const image=document.getElementById('deviceQr');if(ready)image.src=state.qr;else image.removeAttribute('src');
   if(first){first=false;if(!state.configured)wizard.showModal();}
  }catch(error){document.getElementById('deviceStatus').textContent=error.message;}
 }
 async function mode(value){if(busy)return;busy=true;wizard.close();navigate('connect');
  document.getElementById('deviceLink').hidden=true;
  document.getElementById('deviceStatus').textContent='Starting connection…';
  try{await window.airdrop.devices('mode',{mode:value,address:document.getElementById('lanInterface').value||undefined});}
  catch(error){document.getElementById('deviceStatus').textContent=error.message;}
  finally{busy=false;await render();}
 }
 for(const id of ['wizardTailnet','connectTailnet'])document.getElementById(id).onclick=()=>mode('tailscale');
 for(const id of ['wizardLan','connectLan'])document.getElementById(id).onclick=()=>mode('lan');
 for(const id of ['wizardLocal','disconnectDevices'])document.getElementById(id).onclick=()=>mode('local');
 document.getElementById('deviceLogin').onclick=()=>window.airdrop.devices('login').catch(error=>{document.getElementById('deviceStatus').textContent=error.message;});
 document.getElementById('deviceHttps').onclick=()=>window.airdrop.devices('https-settings');
 document.getElementById('copyDeviceAddress').onclick=()=>window.airdrop.devices('copy');
 wizard.addEventListener('cancel',event=>{event.preventDefault();mode('local');});
 render();setInterval(()=>{if(!busy)render();},1500);
})();
