const assert=require('assert');
const {computeMaterialEstimate,MATERIALS}=require('../src/services/materialEstimate');
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const base={shape:'rond',materialId:'acier',quantity:10,lengthMm:100,lossMm:3,diameterMm:50};
let r=computeMaterialEstimate(base);near(r.unitKg,Math.PI*25**2*100*7.85/1e6);near(r.totalKg,r.unitKg*10);near(r.totalLengthM,1.03);
r=computeMaterialEstimate({...base,shape:'plat',widthMm:80,heightMm:20,lossMm:0});near(r.unitKg,80*20*100*7.85/1e6);near(r.totalLengthM,1);
r=computeMaterialEstimate({...base,shape:'tube',diameterMm:50,innerDiameterMm:20});near(r.unitKg,Math.PI*(50**2-20**2)/4*100*7.85/1e6);
for(const invalid of [{...base,materialId:'inventé'},{...base,shape:'autre'},{...base,quantity:2.5},{...base,quantity:0},{...base,lossMm:-1},{...base,lengthMm:0},{...base,diameterMm:NaN},{...base,shape:'tube',innerDiameterMm:50},{...base,shape:'tube',innerDiameterMm:-1},{...base,shape:'plat',widthMm:0,heightMm:20}])assert.throws(()=>computeMaterialEstimate(invalid));
// Independent hand-calculated reference cases (kg), plus loss affects length only.
r=computeMaterialEstimate({shape:'plat',materialId:'acier',quantity:4,lengthMm:1000,lossMm:5,widthMm:100,heightMm:10});near(r.unitKg,7.85);near(r.totalKg,31.4);near(r.totalLengthM,4.02);
r=computeMaterialEstimate({shape:'rond',materialId:'aluminium',quantity:1,lengthMm:1000,lossMm:0,diameterMm:20});near(r.unitKg,0.8482300164692442);
r=computeMaterialEstimate({shape:'tube',materialId:'acier',quantity:2,lengthMm:1000,lossMm:10,diameterMm:100,innerDiameterMm:80});near(r.unitKg,22.195352097611885);near(r.totalLengthM,2.02);
assert.equal(MATERIALS.length,9);
console.log('✅ Calcul matière : rond, plat, tube, pertes et validations');
