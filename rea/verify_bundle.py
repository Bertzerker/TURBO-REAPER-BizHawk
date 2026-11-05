"""Read-only offline verification of a REA investigation ZIP."""
import hashlib, json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    names=archive.namelist()
    assert len(names)==len(set(names)), 'Duplicate ZIP entries'
    manifest=json.loads(archive.read('manifest.json'))
    expected={'manifest.json'}
    for entry in manifest['files']:
        name=entry['name']
        assert '/' not in name and '\\' not in name and name not in ('.','..'), 'Unsafe filename'
        data=archive.read(name)
        assert len(data)==entry['bytes'], f'Length mismatch: {name}'
        assert hashlib.sha256(data).hexdigest()==entry['sha256'], f'Hash mismatch: {name}'
        expected.add(name)
    assert set(names)==expected, 'Unexpected or missing files'
    assert manifest['inspectionSnapshot'] and not manifest['restorableCheckpoint']
    if 'catalog-observation.json' in names:
        annotation=json.loads(archive.read('annotation.json'))
        observation=json.loads(archive.read('catalog-observation.json'))
        assert observation==annotation['tracking'], 'Catalog attachment differs from annotation'
        assert observation['capture']['id']==manifest['capture']['id'], 'Wrong tracked capture ID'
        assert observation['capture']['frame']==manifest['capture']['frame'], 'Wrong tracked frame'
        assert observation['capture']['sha256']==hashlib.sha256(archive.read('capture.bin')).hexdigest(), 'Wrong tracked capture hash'
        selectors=json.dumps(observation['entry']['selectors'],separators=(',',':')).encode()
        assert observation['selectorSha256']==hashlib.sha256(selectors).hexdigest(), 'Wrong selector hash'
        assert observation['game']['digest']['value']==manifest['capture']['rom']['mappedSha256'].lower(), 'Wrong tracked HuCard identity'
        for name in ('catalog-observation.json','catalog-isolation.png'):
            if name in names:
                assert annotation['files'][name]['sha256']==hashlib.sha256(archive.read(name)).hexdigest(), f'Wrong annotation hash: {name}'
        movie=observation['movie']
        if movie['archived']:
            digest=hashlib.sha256(archive.read('movie.bk2')).hexdigest()
            assert movie['sha256']==annotation['movie']['sha256']==digest, 'Wrong replay digest'
            if movie.get('sourceSha256'):
                assert movie['sourceSha256'].lower()==digest, 'Wrong source replay digest'
    print(json.dumps({'ok':True,'frame':manifest['capture']['frame'],'files':len(names)}))
