var glMat4 = require('gl-mat4')
var glVec3 = require('gl-vec3')

// First we create a canvas that we'll later render our 3d model onto
var canvas = document.createElement('canvas')
canvas.width = 400
canvas.height = 400
canvas.style.display = 'block'

// Get our WebGL Context that we'll use to pass data to the GPU
var gl = canvas.getContext('webgl')
gl.enable(gl.DEPTH_TEST)

// Create a label that shows which item we are holding
var stickLabel = document.createElement('span')
stickLabel.style.marginLeft = '10px'
stickLabel.style.fontFamily = 'Helvetica Neue'
stickLabel.style.fontSize = '23px'
stickLabel.innerHTML = 'Short Stick'

// Create a button that will toggle the currently held item
var toggleStickButton = document.createElement('button')
toggleStickButton.style.height = '40px'
toggleStickButton.style.cursor = 'pointer'
toggleStickButton.innerHTML = 'Click to change stick'
var useLongStick = false
toggleStickButton.onclick = function () {
  useLongStick = !useLongStick
  stickLabel.innerHTML = useLongStick ? 'Monkey stick' : 'Short stick'
}

// We insert our canvas and controls into the page
var demoLocation = document.querySelector('#wield-animation-tutorial') || document.body
demoLocation.appendChild(toggleStickButton)
demoLocation.appendChild(stickLabel)
demoLocation.appendChild(canvas)

// Grab our model's JSON data that we'll use to know how to render it
var cowboyJSON = require('./cowboy-model.json')
// We convert our joint matrices into dual quaternions.
// Dual quaternions are easier to blend
// see: https://www.cs.utah.edu/~ladislav/kavan07skinning/kavan07skinning.pdf
var keyframesToDualQuats = require('keyframes-to-dual-quats')
cowboyJSON.keyframes = keyframesToDualQuats(cowboyJSON.keyframes)

var createItemVertexShader = function (opts) {
  return `
    attribute vec3 aVertexPosition;

    uniform mat4 uStartOffsetMatrix;
    uniform vec3 uHandBindPosition;

    uniform mat4 uHandMVMatrix;
    uniform mat4 uPMatrix;

    void main (void) {
      // Multiply by a matrix that rotates the sword by 90%
      vec4 vertexPosition = uStartOffsetMatrix * vec4(aVertexPosition, 1.0);

      vertexPosition = vertexPosition + vec4(uHandBindPosition, 1.0);
      vertexPosition.w = 1.0;

      gl_Position = uPMatrix * uHandMVMatrix * vertexPosition;
    }
  `
}

var createItemFragmentShader = function () {
  return `
    precision mediump float;
    uniform vec4 uVertexColor;
    void main(void) {
      gl_FragColor = uVertexColor;
    }
  `
}

// Load up all of our texture and model data
var cowboyModel
var texture = new window.Image()
var monkeyStick
var shortStick
texture.onload = function () {
  // We buffer our 3d model data on the GPU so that we can later draw it
  var loadCollada = require('load-collada-dae')
  cowboyModel = loadCollada(gl, cowboyJSON, {texture: texture})

  var loadWFObj = require('load-wavefront-obj')
  shortStick = loadWFObj(gl, require('./short-sword.json'), {
    createVertexShader: createItemVertexShader,
    createFragmentShader: createItemFragmentShader,
    // We aren't using this texture, the library just currently requires
    // one to be passed in...
    textureImage: texture
  })
  monkeyStick = loadWFObj(gl, require('./long-sword.json'), {
    createVertexShader: createItemVertexShader,
    createFragmentShader: createItemFragmentShader,
    // We aren't using this texture, the library just currently requires
    // one to be passed in...
    textureImage: texture
  })
}
texture.src = '/cowboy-texture.png'

// We use the number of seconds that have elapsed to know
// how much to interpolate our model's joints
var secondsElapsed = 0

// We create a request animation frame loop in which we'll re-draw our
// animation every time the browser is ready for a new frame
var renderLoop = require('raf-loop')
var animationSystem = require('skeletal-animation-system')

var perspectiveMatrix = require('gl-mat4/perspective')([], Math.PI / 4, 400 / 400, 0.1, 100)

// Get the inverse bind of the right hand, transpose it from Blender's
// row major matrix format to the column major that WebGL uses
// then invert it to get the hand's bine matrix
var handJointIndex = cowboyJSON.jointNamePositionIndex['Hand_R']
var handRInverseBind = cowboyJSON.jointInverseBindPoses[handJointIndex]
var handRBind = []
require('gl-mat4/transpose')(handRInverseBind, handRInverseBind)
require('gl-mat4/invert')(handRBind, handRInverseBind)

// Change our hand matrix from right handed coordinates (Blender) to left (WebGL)
var changeMat4CoordinateSystem = require('change-mat4-coordinate-system')
handRBind = changeMat4CoordinateSystem.rightToLeft(handRBind)

// Get the bind location of the hand bone in model space
// We'll use this to position the sticks on the hand
// After we position them on the hand, we'll rotate them with the hand
var handBindLocation = [ handRBind[12], handRBind[13], handRBind[14] ]

renderLoop(function (millisecondsSinceLastRender) {
  // Create a directional light vector
  var lightingDirection = [1, -1, -4]
  glVec3.normalize(lightingDirection, lightingDirection)
  glVec3.scale(lightingDirection, lightingDirection, -1)

  var cowboyUniforms = {
    // Whether or not we want our shader to calculate per-vertex lighting
    uUseLighting: true,
    uAmbientColor: [0.9, 0.9, 0.9],
    uLightingDirection: lightingDirection,
    uDirectionalColor: [1, 0, 0],
    // Move the model back 27 units so we can see it
    uPMatrix: perspectiveMatrix
  }

  // We don't try to draw our model until it's been loaded
  if (cowboyModel) {
    // We calculate the dual quaternions for all of our joints at this
    // point in time. By passing these into our shader as uniforms our
    // model will be rendered at the correct pose for our time
    secondsElapsed += millisecondsSinceLastRender / 1000
    var interpolatedJoints = animationSystem.interpolateJoints({
      currentTime: secondsElapsed,
      keyframes: cowboyJSON.keyframes,
      jointNums: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      currentAnimation: {
        range: [6, 17],
        startTime: 0
      }
    }).joints

    // Add our joint's dual quaternions into our uniform data to pass to our vertex shader
    for (var i = 0; i < 18; i++) {
      cowboyUniforms['boneRotQuaternions' + i] = interpolatedJoints[i].slice(0, 4)
      cowboyUniforms['boneTransQuaternions' + i] = interpolatedJoints[i].slice(4, 8)
    }

    // Get the matrix that transforms our hand from the bind position to the current
    // animated position. We use this matrix to transform our stick from being placed
    // directly on top of the bind position to being translated and rotated relative
    // to the hand's bind. By doing this we make our stick track our hand
    //
    // In the future we could avoid needing to do this by just converting all of
    // our matrices to left handed up front, but that would require me to
    // change the default shader.. I'll get around to it..
    var animatedHandRMatrix = changeMat4CoordinateSystem.rightToLeft(
      require('dual-quat-to-mat4')(
        interpolatedJoints[9].concat(interpolatedJoints[9])
      )
    )

    // Create a matrix that represents the parent model (player)'s location in world space
    var mvMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.0, -1.0, -27.0, 1]

    // Get the matrix that will animate our stick about the hand bone
    var handModelViewMatrix = []
    glMat4.multiply(handModelViewMatrix, mvMatrix, animatedHandRMatrix)

    // The right hand bone is located a little above the hand, so we offset our
    // stick in order to place it inside of the hand. Our stick is facing up,
    // so we also rotate is along the `x` axis by 90 degrees to point
    // it towards the viewer
    //
    // Using offsets if important because different characters might have
    // different grips or distances from the bone
    var stickOffsetFromHand = glMat4.create()
    glMat4.translate(stickOffsetFromHand, stickOffsetFromHand, [0.0, -1.0, -0.1])
    glMat4.rotateX(stickOffsetFromHand, stickOffsetFromHand, Math.PI / 2)
    // This stops the stick from intersecting with the right leg
    glMat4.rotateZ(stickOffsetFromHand, stickOffsetFromHand, Math.PI / 4)

    if (useLongStick) {
      // Render the blue monkey stick
      gl.useProgram(monkeyStick.shader.program)
      monkeyStick.draw({
        attributes: monkeyStick.attributes,
        uniforms: {
          uVertexColor: [0.0, 0.0, 1.0, 1.0],
          uHandMVMatrix: handModelViewMatrix,
          uPMatrix: perspectiveMatrix,
          uHandBindPosition: handBindLocation,
          uStartOffsetMatrix: stickOffsetFromHand
        }
      })
    } else {
      // Render the green short stick
      gl.useProgram(shortStick.shader.program)
      shortStick.draw({
        attributes: shortStick.attributes,
        uniforms: {
          uVertexColor: [0.0, 1.0, 0.0, 1.0],
          uHandMVMatrix: handModelViewMatrix,
          uPMatrix: perspectiveMatrix,
          uHandBindPosition: handBindLocation,
          uStartOffsetMatrix: stickOffsetFromHand
        }
      })
    }

    // Calculate the normal matrix for lighting
    cowboyUniforms.uMVMatrix = mvMatrix
    cowboyUniforms.uNMatrix = require('gl-mat3/from-mat4')([], mvMatrix)

    // We run a function that sets up and calls `gl.drawElements` in order to
    // draw our model onto the page
    gl.useProgram(cowboyModel.shaderProgram)
    cowboyModel.draw({
      attributes: cowboyModel.attributes,
      uniforms: cowboyUniforms
    })
  }
}).start()

/**
 * Challenge:
 *
 *  see if you can make the character hold one stick in his right hand and the other in his left
 */
