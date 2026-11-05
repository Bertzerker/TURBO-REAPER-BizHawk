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
    print(json.dumps({'ok':True,'frame':manifest['capture']['frame'],'files':len(names)}))
