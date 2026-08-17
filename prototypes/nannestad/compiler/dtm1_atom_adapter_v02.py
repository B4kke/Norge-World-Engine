#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Optional
ATOM='http://www.w3.org/2005/Atom'; GEORSS='http://www.georss.org/georss'; NS={'a':ATOM,'g':GEORSS}
TARGET_EPSG25832=(611000.0,6677000.0,612000.0,6678000.0)
class FeedError(RuntimeError): pass
class UnresolvedSpatialIndex(FeedError): pass
def canon(o): return json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def sha256(b): return hashlib.sha256(b).hexdigest()
def txt(node,path):
    x=node.find(path,NS); return x.text.strip() if x is not None and x.text else None
def links(node):
    return [{'rel':x.get('rel') or 'alternate','href':x.get('href'),'type':x.get('type'),'hreflang':x.get('hreflang'),'title':x.get('title')} for x in node.findall('a:link',NS) if x.get('href')]
def categories(node):
    return [{'term':x.get('term'),'scheme':x.get('scheme'),'label':x.get('label')} for x in node.findall('a:category',NS)]
def georss_polygon(node):
    p=node.find('g:polygon',NS)
    if p is None or not p.text:return None
    vals=[float(v) for v in p.text.split()]
    if len(vals)<8 or len(vals)%2:raise FeedError('invalid GeoRSS polygon')
    return [(vals[i+1],vals[i]) for i in range(0,len(vals),2)]
def georss_box(node):
    b=node.find('g:box',NS)
    if b is None or not b.text:return None
    vals=[float(v) for v in b.text.split()]
    if len(vals)!=4:raise FeedError('invalid GeoRSS box')
    lat1,lon1,lat2,lon2=vals; return [(min(lon1,lon2),min(lat1,lat2)),(max(lon1,lon2),max(lat1,lat2))]
@dataclass(frozen=True)
class Entry:
    id:str; title:str; published:Optional[str]; updated:Optional[str]; links:list; categories:list; georss_polygon:Optional[list]; georss_box:Optional[list]
def parse_feed(xml_bytes):
    root=ET.fromstring(xml_bytes); out=[]
    for e in root.findall('a:entry',NS):
        out.append(Entry(txt(e,'a:id') or '',txt(e,'a:title') or '',txt(e,'a:published'),txt(e,'a:updated'),links(e),categories(e),georss_polygon(e),georss_box(e)))
    return out
def relation_href(ls,preferred=('alternate',)):
    for rel in preferred:
        for l in ls:
            if l['rel']==rel and l['href']: return l['href']
    return None
def select_service_dataset(entries,token='DTM1'):
    matches=[e for e in entries if token.casefold() in (' '.join([e.id,e.title]+[str(c.get('term') or '') for c in e.categories])).casefold() and relation_href(e.links,('alternate',))]
    if len(matches)!=1: raise FeedError(f'expected exactly one explicit service dataset match for {token}, got {len(matches)}')
    return matches[0],relation_href(matches[0].links,('alternate',))
def category_crs(entry):
    vals=[]
    for c in entry.categories:
        s=' '.join(str(c.get(k) or '') for k in ('term','label','scheme')).upper()
        if '25832' in s or 'UTM32' in s or 'UTM 32' in s: vals.append('EPSG:25832')
        if '25833' in s or 'UTM33' in s or 'UTM 33' in s: vals.append('EPSG:25833')
    return sorted(set(vals))
def bbox_geo(entry):
    if entry.georss_box:
        (a,b),(c,d)=entry.georss_box; return (a,b,c,d)
    if entry.georss_polygon:
        xs=[p[0] for p in entry.georss_polygon]; ys=[p[1] for p in entry.georss_polygon]; return (min(xs),min(ys),max(xs),max(ys))
    return None
def target_wgs84_bbox(bounds=TARGET_EPSG25832):
    from pyproj import Transformer
    t=Transformer.from_crs('EPSG:25832','EPSG:4326',always_xy=True)
    pts=[t.transform(x,y) for x in (bounds[0],bounds[2]) for y in (bounds[1],bounds[3])]
    return (min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts))
def contains(o,i):return o[0]<=i[0] and o[1]<=i[1] and o[2]>=i[2] and o[3]>=i[3]
def select_dataset_entry(entries,target=TARGET_EPSG25832,required_crs='EPSG:25832'):
    tg=target_wgs84_bbox(target); matches=[]; unresolved=[]
    for e in entries:
        if required_crs not in category_crs(e):continue
        b=bbox_geo(e)
        if b is None: unresolved.append(e); continue
        if contains(b,tg): matches.append(e)
    if len(matches)==1:
        href=relation_href(matches[0].links,('alternate','enclosure'))
        if not href: raise FeedError('selected dataset entry lacks dataset href')
        return matches[0],href,tg
    if len(matches)>1: raise UnresolvedSpatialIndex(f'multiple GeoRSS entries contain target: {len(matches)}')
    if unresolved: raise UnresolvedSpatialIndex(f'UNRESOLVED_SPATIAL_INDEX: {len(unresolved)} CRS-compatible entries lack GeoRSS bounds; filename/id/title inference forbidden')
    raise FeedError('no CRS-compatible dataset entry contains target')
def retrieval_identity(service_url,dataset_url,e):
    return {'service_feed_url':service_url,'dataset_feed_url':dataset_url,'dataset_entry_id':e.id,'dataset_entry_href':relation_href(e.links,('alternate','enclosure')),'dataset_entry_updated':e.updated,'dataset_entry_category_crs':category_crs(e),'dataset_entry_georss_polygon':e.georss_polygon,'dataset_entry_georss_box':e.georss_box}
def source_snapshot(ri,raw,metadata):
    required=('crs','vertical_datum','pixel_size','bounds','nodata'); missing=[k for k in required if k not in metadata]
    if missing: raise FeedError('source validation missing '+','.join(missing))
    if metadata['crs']!='EPSG:25832': raise FeedError('unexpected DTM1 CRS for Prototype 0')
    return {'schema':'nwe.source-snapshot.v0.2','source_id':'kartverket:hoyde-dtm1','retrieval_identity':ri,'raw_sha256':sha256(raw),'raw_byte_size':len(raw),'source_crs':metadata['crs'],'source_vertical_datum':metadata['vertical_datum'],'z_semantics':'normal_height_m','pixel_size':metadata['pixel_size'],'source_bounds':metadata['bounds'],'nodata':metadata['nodata'],'license_profile':'CC-BY-4.0','promotion_state':'VALIDATED_SOURCE'}
