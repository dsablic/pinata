# wizard: drawing guide

Each view at 48 px tall, the camera 14 degrees above the horizon. Positions are pixels from the top-left of the view image; "top faces" is where a two-joint sprite's top row ends up on screen in this view at rest (the sprite is drawn along +x from joint A to joint B).

## front (facing 0 degrees; image front.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| robe | chest -> hem | 23.0, 22.4 | 23.0, 45.7 | 23.3 | 6.7, 8.6 | right |
| head | head | 23.0, 18.2 | - | - | 4.8 | upright |
| hatCone | hatBase -> hatTip | 23.0, 14.9 | 23.0, 9.1 | 5.8 | 5.3, 1.4 | left |
| brim | brimA -> brimB | 23.0, 16.3 | 23.0, 14.5 | 1.9 | 9.6 (box) | left |
| thighL | hipL -> kneeL | 24.9, 35.2 | 24.9, 44.7 | 9.5 | 2.9, 2.9 | right |
| shinL | kneeL -> ankleL | 24.9, 44.7 | 24.9, 53.6 | 8.9 | 2.9, 2.9 | right |
| footL | ankleL -> toeL | 24.9, 53.6 | 24.9, 54.5 | 0.9 | 2.9, 2.9 | right |
| thighR | hipR -> kneeR | 21.1, 35.2 | 21.1, 44.7 | 9.5 | 2.9, 2.9 | right |
| shinR | kneeR -> ankleR | 21.1, 44.7 | 21.1, 53.6 | 8.9 | 2.9, 2.9 | right |
| footR | ankleR -> toeR | 21.1, 53.6 | 21.1, 54.5 | 0.9 | 2.9, 2.9 | right |
| upperArmL | shoulderL -> elbowL | 27.1, 22.9 | 27.8, 29.6 | 6.7 | 3.1, 3.4 | right |
| forearmL | elbowL -> wristL | 27.8, 29.6 | 28.0, 35.6 | 6.0 | 3.4, 3.6 | right |
| handL | handL | 28.0, 36.8 | - | - | 2.6 | upright |
| upperArmR | shoulderR -> elbowR | 18.9, 22.9 | 18.2, 29.6 | 6.7 | 3.1, 3.4 | right |
| forearmR | elbowR -> wristR | 18.2, 29.6 | 18.0, 35.6 | 6.0 | 3.4, 3.6 | right |
| handR | handR | 18.0, 36.8 | - | - | 2.6 | upright |

## frontSide (facing 45 degrees; image frontSide.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| robe | chest -> hem | 23.0, 22.4 | 23.0, 45.7 | 23.3 | 6.7, 8.6 | right |
| head | head | 23.0, 18.2 | - | - | 4.8 | upright |
| hatCone | hatBase -> hatTip | 23.0, 14.9 | 23.0, 9.1 | 5.8 | 5.3, 1.4 | left |
| brim | brimA -> brimB | 23.0, 16.3 | 23.0, 14.5 | 1.9 | 13.6 (box) | left |
| thighL | hipL -> kneeL | 24.4, 34.9 | 24.9, 44.3 | 9.5 | 2.9, 2.9 | right |
| shinL | kneeL -> ankleL | 24.9, 44.3 | 24.4, 53.3 | 9.0 | 2.9, 2.9 | right |
| footL | ankleL -> toeL | 24.4, 53.3 | 26.9, 53.9 | 2.6 | 2.9, 2.9 | up |
| thighR | hipR -> kneeR | 21.6, 35.5 | 22.2, 45.0 | 9.5 | 2.9, 2.9 | right |
| shinR | kneeR -> ankleR | 22.2, 45.0 | 21.6, 53.9 | 9.0 | 2.9, 2.9 | right |
| footR | ankleR -> toeR | 21.6, 53.9 | 24.2, 54.5 | 2.6 | 2.9, 2.9 | up |
| upperArmL | shoulderL -> elbowL | 25.9, 22.2 | 26.9, 28.7 | 6.6 | 3.1, 3.4 | right |
| forearmL | elbowL -> wristL | 26.9, 28.7 | 27.6, 34.6 | 5.9 | 3.4, 3.6 | right |
| handL | handL | 27.9, 35.8 | - | - | 2.6 | upright |
| upperArmR | shoulderR -> elbowR | 20.1, 23.6 | 20.1, 30.3 | 6.8 | 3.1, 3.4 | right |
| forearmR | elbowR -> wristR | 20.1, 30.3 | 20.5, 36.3 | 6.0 | 3.4, 3.6 | right |
| handR | handR | 20.8, 37.6 | - | - | 2.6 | upright |

## side (facing 90 degrees; image side.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| robe | chest -> hem | 23.0, 22.4 | 23.0, 45.7 | 23.3 | 6.7, 8.6 | right |
| head | head | 23.0, 18.2 | - | - | 4.8 | upright |
| hatCone | hatBase -> hatTip | 23.0, 14.9 | 23.0, 9.1 | 5.8 | 5.3, 1.4 | left |
| brim | brimA -> brimB | 23.0, 16.3 | 23.0, 14.5 | 1.9 | 9.6 (box) | left |
| thighL | hipL -> kneeL | 23.0, 34.7 | 23.7, 44.1 | 9.3 | 2.9, 2.9 | right |
| shinL | kneeL -> ankleL | 23.7, 44.1 | 23.0, 53.1 | 9.1 | 2.9, 2.9 | right |
| footL | ankleL -> toeL | 23.0, 53.1 | 26.6, 53.1 | 3.6 | 2.9, 2.9 | up |
| thighR | hipR -> kneeR | 23.0, 35.7 | 23.7, 45.0 | 9.3 | 2.9, 2.9 | right |
| shinR | kneeR -> ankleR | 23.7, 45.0 | 23.0, 54.1 | 9.1 | 2.9, 2.9 | right |
| footR | ankleR -> toeR | 23.0, 54.1 | 26.6, 54.1 | 3.6 | 2.9, 2.9 | up |
| upperArmL | shoulderL -> elbowL | 23.0, 21.9 | 23.7, 28.2 | 6.4 | 3.1, 3.4 | right |
| forearmL | elbowL -> wristL | 23.7, 28.2 | 24.4, 34.0 | 5.8 | 3.4, 3.6 | right |
| handL | handL | 24.9, 35.2 | - | - | 2.6 | upright |
| upperArmR | shoulderR -> elbowR | 23.0, 23.9 | 23.7, 30.5 | 6.7 | 3.1, 3.4 | right |
| forearmR | elbowR -> wristR | 23.7, 30.5 | 24.4, 36.4 | 5.9 | 3.4, 3.6 | right |
| handR | handR | 24.9, 37.6 | - | - | 2.6 | upright |

## backSide (facing 135 degrees; image backSide.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| robe | chest -> hem | 23.0, 22.4 | 23.0, 45.7 | 23.3 | 6.7, 8.6 | right |
| head | head | 23.0, 18.2 | - | - | 4.8 | upright |
| hatCone | hatBase -> hatTip | 23.0, 14.9 | 23.0, 9.1 | 5.8 | 5.3, 1.4 | left |
| brim | brimA -> brimB | 23.0, 16.3 | 23.0, 14.5 | 1.9 | 13.6 (box) | left |
| thighL | hipL -> kneeL | 21.6, 34.9 | 22.2, 44.1 | 9.2 | 2.9, 2.9 | right |
| shinL | kneeL -> ankleL | 22.2, 44.1 | 21.6, 53.3 | 9.2 | 2.9, 2.9 | right |
| footL | ankleL -> toeL | 21.6, 53.3 | 24.2, 52.7 | 2.6 | 2.9, 2.9 | up |
| thighR | hipR -> kneeR | 24.4, 35.5 | 24.9, 44.7 | 9.2 | 2.9, 2.9 | right |
| shinR | kneeR -> ankleR | 24.9, 44.7 | 24.4, 53.9 | 9.2 | 2.9, 2.9 | right |
| footR | ankleR -> toeR | 24.4, 53.9 | 26.9, 53.3 | 2.6 | 2.9, 2.9 | up |
| upperArmL | shoulderL -> elbowL | 20.1, 22.2 | 20.1, 28.4 | 6.3 | 3.1, 3.4 | right |
| forearmL | elbowL -> wristL | 20.1, 28.4 | 20.5, 34.1 | 5.7 | 3.4, 3.6 | right |
| handL | handL | 20.8, 35.2 | - | - | 2.6 | upright |
| upperArmR | shoulderR -> elbowR | 25.9, 23.6 | 26.9, 30.1 | 6.6 | 3.1, 3.4 | right |
| forearmR | elbowR -> wristR | 26.9, 30.1 | 27.6, 35.8 | 5.8 | 3.4, 3.6 | right |
| handR | handR | 27.9, 36.9 | - | - | 2.6 | upright |

## back (facing 180 degrees; image back.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| robe | chest -> hem | 23.0, 22.4 | 23.0, 45.7 | 23.3 | 6.7, 8.6 | right |
| head | head | 23.0, 18.2 | - | - | 4.8 | upright |
| hatCone | hatBase -> hatTip | 23.0, 14.9 | 23.0, 9.1 | 5.8 | 5.3, 1.4 | left |
| brim | brimA -> brimB | 23.0, 16.3 | 23.0, 14.5 | 1.9 | 9.6 (box) | left |
| thighL | hipL -> kneeL | 21.1, 35.2 | 21.1, 44.3 | 9.1 | 2.9, 2.9 | right |
| shinL | kneeL -> ankleL | 21.1, 44.3 | 21.1, 53.6 | 9.3 | 2.9, 2.9 | right |
| footL | ankleL -> toeL | 21.1, 53.6 | 21.1, 52.7 | 0.9 | 2.9, 2.9 | left |
| thighR | hipR -> kneeR | 24.9, 35.2 | 24.9, 44.3 | 9.1 | 2.9, 2.9 | right |
| shinR | kneeR -> ankleR | 24.9, 44.3 | 24.9, 53.6 | 9.3 | 2.9, 2.9 | right |
| footR | ankleR -> toeR | 24.9, 53.6 | 24.9, 52.7 | 0.9 | 2.9, 2.9 | left |
| upperArmL | shoulderL -> elbowL | 18.9, 22.9 | 18.2, 29.2 | 6.4 | 3.1, 3.4 | right |
| forearmL | elbowL -> wristL | 18.2, 29.2 | 18.0, 34.9 | 5.7 | 3.4, 3.6 | right |
| handL | handL | 18.0, 35.9 | - | - | 2.6 | upright |
| upperArmR | shoulderR -> elbowR | 27.1, 22.9 | 27.8, 29.2 | 6.4 | 3.1, 3.4 | right |
| forearmR | elbowR -> wristR | 27.8, 29.2 | 28.0, 34.9 | 5.7 | 3.4, 3.6 | right |
| handR | handR | 28.0, 35.9 | - | - | 2.6 | upright |

