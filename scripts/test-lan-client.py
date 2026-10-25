#!/usr/bin/env python3
"""Real paired HTTP transfers from another process/network namespace.

Read the private pairing URL from stdin, never argv or logs. This is not proof
of a physical phone/tablet or Wi-Fi path. Only test against your owned workspace.
"""
import http.client
import io
import ipaddress
import json
import time
from urllib.parse import urlsplit
import zipfile

url=urlsplit(input().strip())
address=ipaddress.ip_address(url.hostname)
assert url.scheme=='http' and address.version==4 and any(address in ipaddress.ip_network(net) for net in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'])
assert url.port and len(url.fragment)>=32
origin=f'http://{url.hostname}:{url.port}'
cookie=''
def request(method,path,body=None,extra=None,paired=True):
 headers={'Origin':origin,**(extra or {})}
 if paired:headers['Cookie']=cookie
 connection=http.client.HTTPConnection(url.hostname,url.port,timeout=20)
 try:
  connection.request(method,path,body=body,headers=headers)
  response=connection.getresponse();return response.status,dict(response.getheaders()),response.read()
 finally:connection.close()
assert request('GET','/push/health',paired=False)[0]==401
status,headers,_=request('POST','/pair/',json.dumps({'token':url.fragment}),{'Content-Type':'application/json'},paired=False)
assert status==204
cookie=headers['Set-Cookie'].split(';')[0]
status,_,body=request('GET','/push/health');assert status==200 and json.loads(body)=={'push':True,'share':True}
assert request('GET','/ui/')[0]==200
name=f'network-namespace-client-{time.time_ns()}.txt';payload=b'actual cross-namespace paired transfer'
assert request('PUT','/push/files/'+name,payload)[0]==201
status,_,body=request('GET','/'+name);assert status==200 and body==payload
status,_,body=request('POST','/push/archive',json.dumps({'files':[name]}),{'Content-Type':'application/json'});assert status==200
with zipfile.ZipFile(io.BytesIO(body)) as archive:assert archive.read(name)==payload
assert request('PUT','/.clipboard.txt',payload)[0] in [200,201,204]
status,_,body=request('GET','/.clipboard.txt');assert status==200 and body==payload
print(json.dumps({'status':'VERIFIED','scope':'real HTTP from client network namespace; not physical devices','checks':['unauthorized rejection','pairing','health','web UI','upload','download','ZIP contents','shared clipboard']}))
