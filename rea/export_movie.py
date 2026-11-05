"""Export standard SNES gamepad BK2 inputs for AI inspection. Stdlib only."""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

def inspect(movie):
    with zipfile.ZipFile(movie) as archive:
        def read(name, limit=32*1024*1024):
            info=archive.getinfo(name)
            if info.file_size>limit:
                raise ValueError(f'{name} exceeds the inspection limit')
            return archive.read(name).decode('utf-8-sig')
        header=dict(line.split(' ',1) for line in read('Header.txt',65536).splitlines() if ' ' in line)
        if header.get('Platform')!='SNES':
            raise ValueError('Only standard SNES digital gamepad movies are supported')
        lines=read('Input Log.txt').splitlines()
        key=next((s.removeprefix('LogKey:') for s in lines if s.startswith('LogKey:')),None)
        if key is None:
            raise ValueError('Movie does not contain a LogKey')
        names=[s.lstrip('#') for s in key.split('|') if s.lstrip('#')]
        allowed={'Reset','Power'}|{f'P{p} {b}' for p in range(1,9) for b in ['Up','Down','Left','Right','Select','Start','Y','B','X','A','L','R']}
        if any(n not in allowed for n in names):
            raise ValueError('Unsupported peripheral or analog log: preserve the raw BK2 for BizHawk')
        inputs=[]
        for line in lines:
            if not line.startswith('|'):
                continue
            symbols=line.replace('|','')
            if len(symbols)!=len(names):
                raise ValueError('Input row does not match its digital controller LogKey')
            inputs.append({'frame':len(inputs),'pressed':[n for n,s in zip(names,symbols) if s!='.'],'mnemonic':line})
        return {'schema':1,'movie':str(movie.resolve()),'sha256':hashlib.sha256(movie.read_bytes()).hexdigest(),
                'header':header,'syncSettings':json.loads(read('SyncSettings.json',1024*1024)),
                'controllerOrder':names,'frameConvention':'Zero-based movie input rows; not absolute game frames',
                'startsFromCheckpoint':header.get('StartsFromSavestate')=='True',
                'frames':inputs}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('movie',type=Path)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    data=inspect(args.movie)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    with args.out.open('x',encoding='utf-8') as f:
        json.dump(data,f,indent=2)
    print(f'Exported {len(data["frames"])} frames to {args.out}')
