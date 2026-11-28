// Calculation only. The estimate never represents a reservation or physical stock.
const MATERIALS = [
  {id:'acier',name:'Acier (42CrMo4 / S235)',density:7.85},
  {id:'inox',name:'Inox (304L / 316L)',density:7.90},
  {id:'aluminium',name:'Aluminium (7075 / 6061)',density:2.70},
  {id:'bronze',name:'Bronze (CuSn12)',density:8.80},
  {id:'laiton',name:'Laiton (CuZn39Pb3)',density:8.50},
  {id:'fonte',name:'Fonte',density:7.20},
  {id:'cuivre',name:'Cuivre',density:8.96},
  {id:'titane',name:'Titane (valeur indicative)',density:4.51},
  {id:'pehd',name:'Polyéthylène PEHD',density:0.95},
  {id:'pom',name:'Plastique POM / Delrin',density:1.41},
  {id:'nylon',name:'Plastique Nylon PA6',density:1.15},
  {id:'ptfe',name:'Plastique PTFE / Téflon',density:2.20}
];
function computeMaterialEstimate(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Données de calcul requises.');
  const {shape,materialId,quantity,lengthMm,lossMm,diameterMm,innerDiameterMm,widthMm,heightMm,sideMm,acrossFlatsMm,wallMm}=input;
  const material=MATERIALS.find(x=>x.id===materialId);
  if(!material||!['rond','plat','tube','carre','hexagonal','tube_rectangulaire'].includes(shape))throw new Error('Choisissez une forme et une matière.');
  function dimension(n,label,allowZero=false){if(typeof n!=='number'||!Number.isFinite(n)||n>1000000||(allowZero?n<0:n<=0))throw new Error(`${label} invalide.`);return n;}
  if(!Number.isInteger(quantity)||quantity<=0||quantity>1000000)throw new Error('La quantité doit être un entier positif.');
  dimension(lengthMm,'Longueur');dimension(lossMm,'Perte de coupe',true);
  let area;
  let dimensions;
  if(shape==='plat'){dimension(widthMm,'Largeur');dimension(heightMm,'Épaisseur');area=widthMm*heightMm;dimensions={widthMm,heightMm};}
  else if(shape==='carre'){dimension(sideMm,'Côté du carré');area=sideMm**2;dimensions={sideMm};}
  else if(shape==='hexagonal'){dimension(acrossFlatsMm,'Distance entre plats');area=Math.sqrt(3)*acrossFlatsMm**2/2;dimensions={acrossFlatsMm};}
  else if(shape==='tube_rectangulaire'){
    dimension(widthMm,'Largeur extérieure');dimension(heightMm,'Hauteur extérieure');dimension(wallMm,'Épaisseur de paroi');
    if(2*wallMm>=Math.min(widthMm,heightMm))throw new Error('La paroi doit être inférieure à la moitié de la plus petite dimension extérieure.');
    area=widthMm*heightMm-(widthMm-2*wallMm)*(heightMm-2*wallMm);dimensions={widthMm,heightMm,wallMm};
  } else {dimension(diameterMm,'Diamètre extérieur');if(shape==='tube'){dimension(innerDiameterMm,'Diamètre intérieur',true);if(innerDiameterMm>=diameterMm)throw new Error('Le diamètre intérieur doit être inférieur au diamètre extérieur.');}area=Math.PI*(diameterMm**2-(shape==='tube'?innerDiameterMm**2:0))/4;dimensions={diameterMm,...(shape==='tube'?{innerDiameterMm}:{})};}
  const inputs={shape,materialId,quantity,lengthMm,lossMm,...dimensions};
  const unitKg=area*lengthMm*material.density/1000000;
  return {inputs,material,unitKg,totalKg:unitKg*quantity,totalLengthM:(lengthMm+lossMm)*quantity/1000};
}
module.exports={MATERIALS,computeMaterialEstimate};
