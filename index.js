/* eslint-disable @typescript-eslint/no-var-requires */
import { Namer } from '@parcel/plugin'
import * as diagnostic from '@parcel/diagnostic'
import * as fs from 'fs'
import assert from 'assert'
import path from 'path'
import nullthrows from 'nullthrows'

// import defaultName from '@parcel/namer-default'

// const COMMON_NAMES = new Set( [ 'index', 'src', 'lib' ] )
const ALLOWED_EXTENSIONS = {
    js: [ 'js', 'mjs', 'cjs' ],
}

// const CONFIG = Symbol.for( 'parcel-plugin-config' )

const MODE = {
    'ALL': 'all',
    'DEVELOPMENT': 'development',
    'PRODUCTION': 'production',
}

function matchFileName( configs, newName ) {
    
    return (
        Array.isArray( configs ) &&
        configs?.some( v => {
            const reg = new RegExp( v )
            let pathname = String( path.resolve( path.normalize( newName ) ) ).split( '\\' ).join( '/' )
            return reg.test( pathname )
        } )
    )
}

function buildNameWithoutHash( { bundle, oldName, logger, include, exclude } ) {
    try {
    // if filename has hash,
        if ( !bundle?.needsStableName ) {
            const nameArr = oldName.split( '.' )
            nameArr.splice( nameArr.length - 2, 1 )
            const newName = nameArr.join( '.' )

            if ( matchFileName( exclude, newName ) ) {
                return oldName
            }

            if ( matchFileName( include, newName ) ) {
                // logger.log( {
                //     message: `${oldName} -> ${newName}`,
                // } )
                return newName
            }

            if ( Array.isArray( include ) ) {
                return oldName
            }

            // logger.log( {
            //     message: `${oldName} -> ${newName}`,
            // } )

            return newName
        }
    } catch ( err ) {
        console.error( err )
    }

    return oldName
}

let namer = new Namer( {
    async loadConfig({ config }) {

        //
        // The damn thing wont behave like all other plugins
        // It always loads the highest level package.json
        // Just read the one where we are...
        // 
        let real_package = path.join(process.cwd(), 'package.json')
        let packageJson = await fs.promises.readFile(real_package, 'utf-8')// config.getPackage()
        packageJson = JSON.parse( packageJson )
        const namerConfig = packageJson?.[ 'parcel-namer-hashless' ]
        // console.log( namerConfig )

        // if parcel-namer-hashless config is matched
        if ( Object.prototype.toString.call( namerConfig ) === '[object Object]' ) {
            return Promise.resolve( namerConfig )
        }

        return Promise.resolve( {} )
    },
    async name( { bundle, bundleGraph, logger, options, config } ) {

        let bundleGroup = bundleGraph.getBundleGroupsContainingBundle( bundle )[ 0 ]
        let bundleGroupBundles = bundleGraph.getBundlesInBundleGroup( bundleGroup, {
            includeInline: true,
        } )
        let isEntry = bundleGraph.isEntryBundleGroup( bundleGroup )

        if ( bundle.needsStableName ) {
            let entryBundlesOfType = bundleGroupBundles.filter(
                ( b ) => b.needsStableName && b.type === bundle.type,
            )
            assert(
                entryBundlesOfType.length === 1,
                // Otherwise, we'd end up naming two bundles the same thing.
                'Bundle group cannot have more than one entry bundle of the same type',
            )
        }

        let mainBundle = nullthrows(
            bundleGroupBundles.find( ( b ) =>
                b.getEntryAssets().some( ( a ) => a.id === bundleGroup.entryAssetId ),
            ),
        )

        if (
            bundle.id === mainBundle.id &&
      isEntry &&
      bundle.target &&
      bundle.target.distEntry != null
        ) {
            let loc = bundle.target.loc
            let distEntry = bundle.target.distEntry
            let distExtension = path.extname( bundle.target.distEntry ).slice( 1 )
            let allowedExtensions = ALLOWED_EXTENSIONS[ bundle.type ] || [ bundle.type ]
            if ( !allowedExtensions.includes( distExtension ) && loc ) {
                let fullName = path.relative(
                    path.dirname( loc.filePath ),
                    path.join( bundle.target.distDir, distEntry ),
                )
                let err = new diagnostic.ThrowableDiagnostic( {
                    diagnostic: {
                        message: diagnostic.md`Target "${bundle.target.name}" declares an output file path of "${fullName}" which does not match the compiled bundle type "${bundle.type}".`,
                        codeFrames: [
                            {
                                filePath: loc.filePath,
                                codeHighlights: [
                                    {
                                        start: loc.start,
                                        end: loc.end,
                                        message: md`Did you mean "${
                                            fullName.slice( 0, -path.extname( fullName ).length ) +
                      '.' +
                      bundle.type
                                        }"?`,
                                    },
                                ],
                            },
                        ],
                        hints: [
                            `Try changing the file extension of "${
                                bundle.target.name
                            }" in ${path.relative( process.cwd(), loc.filePath )}.`,
                        ],
                    },
                } )
                throw err
            }

            return bundle.target.distEntry
        }

        // Base split bundle names on the first bundle in their group.
        // e.g. if `index.js` imports `foo.css`, the css bundle should be called
        //      `index.css`.
        let name = nameFromContent(
            mainBundle,
            isEntry,
            bundleGroup.entryAssetId,
            bundleGraph.getEntryRoot( bundle.target ),
        )
        if ( !bundle.needsStableName ) {
            name += '.' + bundle.hashReference
        }

        let oldName = name + '.' + bundle.type

        const { mode: configMode, include, exclude } = config
        const { mode } = options
        
        if ( configMode !== mode || configMode !== 'all' ) {
            return buildNameWithoutHash( { bundle, oldName, logger, include, exclude } )
        }
        
        if ( !configMode ) {

            if ( mode === MODE.DEVELOPMENT ) {
                return oldName
            }
            
            return buildNameWithoutHash( { bundle, oldName, logger, include, exclude } )
        }
    },
} )

function nameFromContent( bundle, isEntry, entryAssetId, entryRoot ) {
    let entryFilePath = nullthrows(
        bundle.getEntryAssets().find( ( a ) => a.id === entryAssetId ),
    ).filePath
    let name = basenameWithoutExtension( entryFilePath )

    // If this is an entry bundle, use the original relative path.
    // if (bundle.needsStableName) {
    // Match name of target entry if possible, but with a different extension.
    if ( isEntry && bundle.target.distEntry != null ) {
        return basenameWithoutExtension( bundle.target.distEntry )
    }

    return path
        .join( path.relative( entryRoot, path.dirname( entryFilePath ) ), name )
        .replace( /\.\.(\/|\\)/g, 'up_$1' )
    // } else {
    //   // If this is an index file or common directory name, use the parent
    //   // directory name instead, which is probably more descriptive.
    //   while (COMMON_NAMES.has(name)) {
    //     entryFilePath = path.dirname(entryFilePath);
    //     name = path.basename(entryFilePath);
    //     if (name.startsWith('.')) {
    //       name = name.replace('.', '');
    //     }
    //   }

    //   return name;
    // }
}

function basenameWithoutExtension( file ) {
    return path.basename( file, path.extname( file ) )
}

export default namer