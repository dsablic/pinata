# dwarf: drawing guide

Each view at 48 px tall, the camera 14 degrees above the horizon. Positions are pixels from the top-left of the view image; "top faces" is where a two-joint sprite's top row ends up on screen in this view at rest (the sprite is drawn along +x from joint A to joint B).

## front (facing 0 degrees; image front.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| torso | pelvis -> chest | 36.0, 36.0 | 36.0, 22.6 | 13.4 | 15.0 (box) | left |
| head | head | 36.0, 14.9 | - | - | 14.2 | upright |
| helmet | helmet | 36.0, 12.5 | - | - | 12.5 | upright |
| beard | chin | 36.0, 19.4 | - | - | 9.2 | upright |
| cloakBack | cloakTop -> cloakBot | 36.0, 22.2 | 36.0, 36.0 | 13.8 | 20.9 (box) | right |
| mantle | shoulderL -> shoulderR | 46.0, 23.8 | 26.0, 23.8 | 20.0 | 7.5, 7.5 | down |
| thighL | hipL -> kneeL | 40.2, 36.8 | 40.2, 44.0 | 7.2 | 6.3, 5.4 | right |
| shinL | kneeL -> ankleL | 40.2, 44.0 | 40.2, 50.2 | 6.2 | 5.4, 5.4 | right |
| footL | ankleL -> toeL | 40.2, 50.2 | 40.2, 51.5 | 1.3 | 5.8, 5.8 | right |
| thighR | hipR -> kneeR | 31.8, 36.8 | 31.8, 44.0 | 7.2 | 6.3, 5.4 | right |
| shinR | kneeR -> ankleR | 31.8, 44.0 | 31.8, 50.2 | 6.2 | 5.4, 5.4 | right |
| footR | ankleR -> toeR | 31.8, 50.2 | 31.8, 51.5 | 1.3 | 5.8, 5.8 | right |
| shoulderL | shoulderL | 46.0, 23.8 | - | - | 8.3 | upright |
| upperArmL | shoulderL -> elbowL | 46.0, 23.8 | 47.7, 30.5 | 6.9 | 5.0, 4.6 | right |
| forearmL | elbowL -> wristL | 47.7, 30.5 | 47.7, 36.2 | 5.7 | 4.6, 4.6 | right |
| handL | handL | 47.7, 38.3 | - | - | 5.4 | upright |
| shoulderR | shoulderR | 26.0, 23.8 | - | - | 8.3 | upright |
| upperArmR | shoulderR -> elbowR | 26.0, 23.8 | 24.3, 30.5 | 6.9 | 5.0, 4.6 | right |
| forearmR | elbowR -> wristR | 24.3, 30.5 | 24.3, 36.2 | 5.7 | 4.6, 4.6 | right |
| handR | handR | 24.3, 38.3 | - | - | 5.4 | upright |
| handle | axeBottom -> axeTop | 24.3, 44.8 | 24.3, 13.2 | 31.6 | 3.3, 3.3 | left |
| blade | bladeA -> bladeB | 20.6, 22.9 | 20.6, 14.0 | 8.9 | 10.0 (box) | left |

## frontSide (facing 45 degrees; image frontSide.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| torso | pelvis -> chest | 31.0, 36.0 | 31.0, 22.6 | 13.4 | 18.3 (box) | left |
| head | head | 31.0, 14.9 | - | - | 14.2 | upright |
| helmet | helmet | 31.0, 12.5 | - | - | 12.5 | upright |
| beard | chin | 33.4, 19.1 | - | - | 9.2 | upright |
| cloakBack | cloakTop -> cloakBot | 26.3, 22.7 | 26.3, 36.5 | 13.8 | 17.1 (box) | right |
| mantle | shoulderL -> shoulderR | 38.1, 22.1 | 23.9, 25.6 | 14.6 | 7.5, 7.5 | down |
| thighL | hipL -> kneeL | 34.0, 36.1 | 34.8, 43.2 | 7.2 | 6.3, 5.4 | right |
| shinL | kneeL -> ankleL | 34.8, 43.2 | 34.0, 49.5 | 6.3 | 5.4, 5.4 | right |
| footL | ankleL -> toeL | 34.0, 49.5 | 37.8, 50.4 | 3.9 | 5.8, 5.8 | up |
| thighR | hipR -> kneeR | 28.0, 37.5 | 28.9, 44.6 | 7.2 | 6.3, 5.4 | right |
| shinR | kneeR -> ankleR | 28.9, 44.6 | 28.0, 50.9 | 6.3 | 5.4, 5.4 | right |
| footR | ankleR -> toeR | 28.0, 50.9 | 31.9, 51.8 | 3.9 | 5.8, 5.8 | up |
| shoulderL | shoulderL | 38.1, 22.1 | - | - | 8.3 | upright |
| upperArmL | shoulderL -> elbowL | 38.1, 22.1 | 39.9, 28.5 | 6.6 | 5.0, 4.6 | right |
| forearmL | elbowL -> wristL | 39.9, 28.5 | 41.0, 34.0 | 5.7 | 4.6, 4.6 | right |
| handL | handL | 41.3, 36.1 | - | - | 5.4 | upright |
| shoulderR | shoulderR | 23.9, 25.6 | - | - | 8.3 | upright |
| upperArmR | shoulderR -> elbowR | 23.9, 25.6 | 23.3, 32.5 | 6.9 | 5.0, 4.6 | right |
| forearmR | elbowR -> wristR | 23.3, 32.5 | 24.5, 38.0 | 5.7 | 4.6, 4.6 | right |
| handR | handR | 24.8, 40.1 | - | - | 5.4 | upright |
| handle | axeBottom -> axeTop | 24.8, 46.6 | 24.8, 15.0 | 31.6 | 3.3, 3.3 | left |
| blade | bladeA -> bladeB | 22.1, 25.4 | 22.1, 16.5 | 8.9 | 9.3 (box) | left |

## side (facing 90 degrees; image side.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| torso | pelvis -> chest | 27.0, 36.0 | 27.0, 22.6 | 13.4 | 10.9 (box) | left |
| head | head | 27.0, 14.9 | - | - | 14.2 | upright |
| helmet | helmet | 27.0, 12.5 | - | - | 12.5 | upright |
| beard | chin | 30.3, 18.6 | - | - | 9.2 | upright |
| cloakBack | cloakTop -> cloakBot | 20.3, 23.8 | 20.3, 37.6 | 13.8 | 3.3 (box) | right |
| mantle | shoulderL -> shoulderR | 27.0, 21.4 | 27.0, 26.3 | 4.8 | 7.5, 7.5 | right |
| thighL | hipL -> kneeL | 27.0, 35.8 | 28.3, 42.7 | 7.0 | 6.3, 5.4 | right |
| shinL | kneeL -> ankleL | 28.3, 42.7 | 27.0, 49.2 | 6.6 | 5.4, 5.4 | right |
| footL | ankleL -> toeL | 27.0, 49.2 | 32.4, 49.2 | 5.4 | 5.8, 5.8 | up |
| thighR | hipR -> kneeR | 27.0, 37.8 | 28.3, 44.7 | 7.0 | 6.3, 5.4 | right |
| shinR | kneeR -> ankleR | 28.3, 44.7 | 27.0, 51.2 | 6.6 | 5.4, 5.4 | right |
| footR | ankleR -> toeR | 27.0, 51.2 | 32.4, 51.2 | 5.4 | 5.8, 5.8 | up |
| shoulderL | shoulderL | 27.0, 21.4 | - | - | 8.3 | upright |
| upperArmL | shoulderL -> elbowL | 27.0, 21.4 | 27.8, 27.5 | 6.1 | 5.0, 4.6 | right |
| forearmL | elbowL -> wristL | 27.8, 27.5 | 29.5, 32.8 | 5.5 | 4.6, 4.6 | right |
| handL | handL | 29.9, 34.8 | - | - | 5.4 | upright |
| shoulderR | shoulderR | 27.0, 26.3 | - | - | 8.3 | upright |
| upperArmR | shoulderR -> elbowR | 27.0, 26.3 | 27.8, 33.1 | 6.9 | 5.0, 4.6 | right |
| forearmR | elbowR -> wristR | 27.8, 33.1 | 29.5, 38.4 | 5.5 | 4.6, 4.6 | right |
| handR | handR | 29.9, 40.4 | - | - | 5.4 | upright |
| handle | axeBottom -> axeTop | 29.9, 46.9 | 29.9, 15.3 | 31.6 | 3.3, 3.3 | left |
| blade | bladeA -> bladeB | 29.9, 26.0 | 29.9, 17.0 | 8.9 | 3.1 (box) | left |

## backSide (facing 135 degrees; image backSide.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| torso | pelvis -> chest | 35.0, 36.0 | 35.0, 22.6 | 13.4 | 18.3 (box) | left |
| head | head | 35.0, 14.9 | - | - | 14.2 | upright |
| helmet | helmet | 35.0, 12.5 | - | - | 12.5 | upright |
| beard | chin | 37.4, 18.0 | - | - | 9.2 | upright |
| cloakBack | cloakTop -> cloakBot | 30.3, 25.0 | 30.3, 38.8 | 13.8 | 17.1 (box) | right |
| mantle | shoulderL -> shoulderR | 27.9, 22.1 | 42.1, 25.6 | 14.6 | 7.5, 7.5 | up |
| thighL | hipL -> kneeL | 32.0, 36.1 | 32.9, 42.8 | 6.7 | 6.3, 5.4 | right |
| shinL | kneeL -> ankleL | 32.9, 42.8 | 32.0, 49.5 | 6.8 | 5.4, 5.4 | right |
| footL | ankleL -> toeL | 32.0, 49.5 | 35.9, 48.5 | 3.9 | 5.8, 5.8 | up |
| thighR | hipR -> kneeR | 38.0, 37.5 | 38.8, 44.2 | 6.7 | 6.3, 5.4 | right |
| shinR | kneeR -> ankleR | 38.8, 44.2 | 38.0, 50.9 | 6.8 | 5.4, 5.4 | right |
| footR | ankleR -> toeR | 38.0, 50.9 | 41.8, 50.0 | 3.9 | 5.8, 5.8 | up |
| shoulderL | shoulderL | 27.9, 22.1 | - | - | 8.3 | upright |
| upperArmL | shoulderL -> elbowL | 27.9, 22.1 | 27.3, 28.2 | 6.1 | 5.0, 4.6 | right |
| forearmL | elbowL -> wristL | 27.3, 28.2 | 28.5, 33.2 | 5.1 | 4.6, 4.6 | right |
| handL | handL | 28.8, 35.1 | - | - | 5.4 | upright |
| shoulderR | shoulderR | 42.1, 25.6 | - | - | 8.3 | upright |
| upperArmR | shoulderR -> elbowR | 42.1, 25.6 | 43.9, 32.2 | 6.9 | 5.0, 4.6 | right |
| forearmR | elbowR -> wristR | 43.9, 32.2 | 45.0, 37.2 | 5.1 | 4.6, 4.6 | right |
| handR | handR | 45.3, 39.1 | - | - | 5.4 | upright |
| handle | axeBottom -> axeTop | 45.3, 45.6 | 45.3, 14.0 | 31.6 | 3.3, 3.3 | left |
| blade | bladeA -> bladeB | 48.0, 24.4 | 48.0, 15.5 | 8.9 | 9.3 (box) | left |

## back (facing 180 degrees; image back.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| torso | pelvis -> chest | 36.0, 36.0 | 36.0, 22.6 | 13.4 | 15.0 (box) | left |
| head | head | 36.0, 14.9 | - | - | 14.2 | upright |
| helmet | helmet | 36.0, 12.5 | - | - | 12.5 | upright |
| beard | chin | 36.0, 17.8 | - | - | 9.2 | upright |
| cloakBack | cloakTop -> cloakBot | 36.0, 25.5 | 36.0, 39.2 | 13.8 | 20.9 (box) | right |
| mantle | shoulderL -> shoulderR | 26.0, 23.8 | 46.0, 23.8 | 20.0 | 7.5, 7.5 | up |
| thighL | hipL -> kneeL | 31.8, 36.8 | 31.8, 43.4 | 6.6 | 6.3, 5.4 | right |
| shinL | kneeL -> ankleL | 31.8, 43.4 | 31.8, 50.2 | 6.8 | 5.4, 5.4 | right |
| footL | ankleL -> toeL | 31.8, 50.2 | 31.8, 48.9 | 1.3 | 5.8, 5.8 | left |
| thighR | hipR -> kneeR | 40.2, 36.8 | 40.2, 43.4 | 6.6 | 6.3, 5.4 | right |
| shinR | kneeR -> ankleR | 40.2, 43.4 | 40.2, 50.2 | 6.8 | 5.4, 5.4 | right |
| footR | ankleR -> toeR | 40.2, 50.2 | 40.2, 48.9 | 1.3 | 5.8, 5.8 | left |
| shoulderL | shoulderL | 26.0, 23.8 | - | - | 8.3 | upright |
| upperArmL | shoulderL -> elbowL | 26.0, 23.8 | 24.3, 30.1 | 6.5 | 5.0, 4.6 | right |
| forearmL | elbowL -> wristL | 24.3, 30.1 | 24.3, 35.0 | 4.9 | 4.6, 4.6 | right |
| handL | handL | 24.3, 36.9 | - | - | 5.4 | upright |
| shoulderR | shoulderR | 46.0, 23.8 | - | - | 8.3 | upright |
| upperArmR | shoulderR -> elbowR | 46.0, 23.8 | 47.7, 30.1 | 6.5 | 5.0, 4.6 | right |
| forearmR | elbowR -> wristR | 47.7, 30.1 | 47.7, 35.0 | 4.9 | 4.6, 4.6 | right |
| handR | handR | 47.7, 36.9 | - | - | 5.4 | upright |
| handle | axeBottom -> axeTop | 47.7, 43.4 | 47.7, 11.8 | 31.6 | 3.3, 3.3 | left |
| blade | bladeA -> bladeB | 51.4, 21.5 | 51.4, 12.6 | 8.9 | 10.0 (box) | left |

