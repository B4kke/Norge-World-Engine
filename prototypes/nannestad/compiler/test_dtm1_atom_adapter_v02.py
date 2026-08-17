import json
from dtm1_atom_adapter_v02 import *
SERVICE=b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>urn:dtm1-service-entry</id><title>DTM1 predefined dataset</title><published>2026-01-01T00:00:00Z</published><updated>2026-08-17T00:00:00Z</updated><link rel="alternate" type="application/atom+xml" href="https://example.invalid/dtm1-dataset.atom"/></entry></feed>'''
DATASET=b'''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:georss="http://www.georss.org/georss"><entry><id>urn:dtm1:tile:fixture</id><title>DTM1 concrete fixture</title><updated>2026-08-17T00:00:00Z</updated><category term="EPSG:25832" label="EUREF89 UTM32"/><link rel="alternate" type="image/tiff" href="https://example.invalid/dtm1.tif"/><georss:box>60.10 10.80 60.35 11.25</georss:box></entry></feed>'''
s=parse_feed(SERVICE); se,du=select_service_dataset(s,'DTM1')
d=parse_feed(DATASET); de,href,tbbox=select_dataset_entry(d)
ri=retrieval_identity('https://example.invalid/service.atom',du,de)
ss=source_snapshot(ri,b'II*'+b'x'*1024,{'crs':'EPSG:25832','vertical_datum':'NN2000','pixel_size':[1,1],'bounds':[600000,6670000,615000,6685000],'nodata':-9999})
BAD=b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tile-611000-6677000</id><title>DTM1 611000 6677000</title><category term="EPSG:25832"/><link rel="alternate" href="https://example.invalid/611000_6677000.tif"/></entry></feed>'''
try:
    select_dataset_entry(parse_feed(BAD)); raise AssertionError('must fail')
except UnresolvedSpatialIndex as e: assert 'UNRESOLVED_SPATIAL_INDEX' in str(e)
print(json.dumps({'status':'PASS','dataset_url':du,'dataset_href':href,'target_wgs84_bbox':tbbox,'source_snapshot_hash':sha256(canon(ss))},indent=2))
