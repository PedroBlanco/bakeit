"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticGen = void 0;
const marked = require("marked");
const fs = require("fs");
const fse = require("fs-extra");
const path = require("path");
const yaml = require("yamljs");
const template_engine_1 = require("./template-engine");
const page_data_1 = require("./page-data");
class StaticGen {
    constructor() {
        this.defaultTemplate = 'main';
        this.sourceIndexFile = 'index.md';
        this.jsonIndexFile = 'index.json';
        this.themeDir = '.theme';
        this.urlsPrefix = '/';
        this.sourceExtension = '.md';
        this.asyncWrites = new Set();
    }
    generate(config) {
        // if previous run isn't finished yet - wait
        this.executeWhenAllDone(() => {
            this.config = config;
            this.sourceRootPath = config.build.sourceDir;
            this.outputRootPath = config.build.outputDir;
            this.themeRootPath = path.join(this.sourceRootPath, this.themeDir);
            this.allPagesData = new Array();
            this.templateEngine = new template_engine_1.TemplateEngine(config, this.themeRootPath);
            fse.emptyDir(this.outputRootPath)
                .then(() => {
                this.generateOutput();
                this.executeWhenAllDone(() => {
                    this.postProcessing();
                });
            });
        });
    }
    generateOutput() {
        this.getFilenames(this.sourceRootPath, null, (dir, files) => {
            var dirPagesData = this.processDir(dir, files);
            this.allPagesData = this.allPagesData.concat(dirPagesData);
        });
    }
    postProcessing() {
        // generate sitemap
        if (this.config.build.sitemapPage !== undefined) {
            var mapPageData = new page_data_1.PageData();
            mapPageData.frontMatter = {
                template: 'sitemap',
                title: 'Site Map'
            };
            mapPageData.url = path.join(this.outputRootPath, this.config.build.sitemapPage);
            mapPageData.config = this.config;
            mapPageData.pages = this.allPagesData;
            console.info(`Generating: ${mapPageData.url}`);
            this.generatePage(mapPageData.url, this.defaultTemplate, mapPageData);
        }
        // copy files
        if (this.config.build.copy !== undefined) {
            this.config.build.copy.forEach(dupPage => {
                var src = dupPage.src;
                var dst = dupPage.dst;
                console.info(`Copying: ${src} -> ${dst}`);
                this.copyAsync(src, dst);
            });
        }
        // pack external scripts
        if (this.config.build.scripts !== undefined) {
            this.config.build.scripts.forEach((item) => {
                this.copyAsync(item, path.join(this.outputRootPath, 'js'));
            });
        }
        // pack external styles
        if (this.config.build.styles !== undefined) {
            this.config.build.styles.forEach((item) => {
                this.copyAsync(item, path.join(this.outputRootPath, 'css'));
            });
        }
    }
    executeWhenAllDone(done) {
        if (this.asyncWrites.size == 0) {
            done();
            return;
        }
        this.onAllAsyncWritesDone = () => {
            this.onAllAsyncWritesDone = null;
            done();
        };
    }
    asyncWriteStarted(file) {
        this.asyncWrites.add(file);
    }
    asyncWriteDone(file) {
        this.asyncWrites.delete(file);
        if (this.asyncWrites.size == 0 && this.onAllAsyncWritesDone !== null) {
            this.onAllAsyncWritesDone();
        }
    }
    processDir(dir, files) {
        console.info(`Processing folder: ${dir}`);
        var dirPagesData = new Array();
        var indexFile = null;
        // collect list of pages
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if (file.endsWith(this.sourceExtension)) {
                var pageData = this.getPageData(file, false);
                dirPagesData.push(pageData);
            }
        }
        // generate html from md files
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if (file.endsWith(this.sourceIndexFile)) {
                indexFile = file;
            }
            else if (file.endsWith(this.sourceExtension)) {
                // markdown (.md) source file
                var pageData = this.getPageData(file);
                pageData.pages = dirPagesData;
                var outputFile = this.getOutputHtmlPageFilename(file);
                console.info(`Generating: ${file} -> ${outputFile}`);
                this.generatePage(outputFile, this.defaultTemplate, pageData);
            }
            else if (!path.basename(file).startsWith('.')) {
                // non markdown source file - just copy it (ignoring files that start from .)
                var outputFile = this.getOutputPath(file);
                console.info(`Copying: ${file} -> ${outputFile}`);
                this.copyAsync(file, outputFile);
            }
        }
        if (indexFile != null) {
            // folder index
            var pageData = this.getPageData(indexFile);
            pageData.pages = dirPagesData;
            var outputFile = this.getOutputHtmlPageFilename(indexFile);
            console.info(`Generating: ${indexFile} -> ${outputFile}`);
            this.generatePage(outputFile, this.defaultTemplate, pageData);
            //var jsonIndexFilename = this.getOutputPath(path.join(dir, this.jsonIndexFile));
            //this.generateIndexJson(jsonIndexFilename, pageData);
        }
        return dirPagesData;
    }
    /*
    private generateIndexJson(filename: string, pageData: any): void {
  
      var contents = {
        map: {
          name: pageData.frontMatter.title,
          center: pageData.frontMatter.latlng,
          zoom: pageData.frontMatter.mapzoom
        },
        pages: []
      };
  
      if (pageData.pages != null) {
        for (var i=0; i< pageData.pages.length; i++) {
  
          var pageData = pageData.pages[i];
  
          var latlng: string = pageData.frontMatter.latlng;
  
          if (pageData.url !== undefined &&
            pageData.frontMatter.hint !== undefined &&
            pageData.frontMatter.section !== undefined &&
            latlng !== undefined) {
  
            contents.pages.push({
              id: pageData.url,
              name: pageData.frontMatter.hint,
              section: pageData.frontMatter.section,
              latlng: latlng.split(',')
            });
          }
        }
      }
  
      this.writeFile(filename, JSON.stringify(contents));
    }
    */
    getPageData(sourceFile, includeContent = true) {
        const fmSeparator = '---';
        const fmLength = fmSeparator.length;
        var pageText = this.readFile(sourceFile);
        var fmBegin = pageText.indexOf(fmSeparator);
        var fmEnd = pageText.indexOf(fmSeparator, fmBegin + fmLength);
        var frontMatterStr = pageText.substring(fmBegin + fmLength, fmEnd);
        var pageData = new page_data_1.PageData();
        pageData.frontMatter = yaml.parse(frontMatterStr);
        pageData.config = this.config;
        pageData.url = this.getPageUrl(sourceFile);
        if (includeContent) {
            pageData.content = marked(pageText.substr(fmEnd + fmLength));
        }
        return pageData;
    }
    generatePage(outputFile, templateName, pageData) {
        try {
            var html = this.templateEngine.renderTemplate(templateName, pageData);
            this.writeFileAsync(outputFile, html);
        }
        catch (err) {
            console.error(`ERROR: can't create ${outputFile}`);
            throw err;
        }
    }
    getOutputPath(sourcePath) {
        var relativePath = path.relative(this.themeRootPath, sourcePath);
        // console.log(relativePath);
        if (relativePath.startsWith('..')) {
            relativePath = path.relative(this.sourceRootPath, sourcePath);
            if (relativePath.startsWith('..')) {
                throw new Error(`Unexpected source file location: ${sourcePath}`);
            }
        }
        return path.join(this.outputRootPath, relativePath);
    }
    /**
     * Raw page URL is URL without urlPrefix and with OS specific dir separator.
     * You can't use them for URLs directly!
     */
    getPageRawUrl(sourceFile) {
        var relativePath = path.relative(this.sourceRootPath, sourceFile);
        var rawUrl;
        if (relativePath.endsWith(this.sourceIndexFile)) {
            var to = relativePath.lastIndexOf(this.sourceIndexFile);
            rawUrl = relativePath.substring(0, to);
        }
        else {
            var to = relativePath.lastIndexOf('.');
            rawUrl = relativePath.substring(0, to);
        }
        return rawUrl;
    }
    getPageUrl(sourceFile) {
        return path.join(this.urlsPrefix, this.getPageRawUrl(sourceFile)).replace(/\\/g, '/');
    }
    getOutputHtmlPageFilename(sourceFile) {
        return path.join(this.outputRootPath, this.getPageRawUrl(sourceFile), 'index.html').replace(/\\/g, '/');
    }
    readFile(file) {
        return fs.readFileSync(file).toString();
    }
    writeFileAsync(file, contents) {
        this.asyncWriteStarted(file);
        fse.ensureDir(path.dirname(file))
            .then(() => {
            fs.writeFile(file, contents, (err) => {
                if (err) {
                    console.error(`ERROR: can't write to ${file}`);
                }
                this.asyncWriteDone(file);
            });
        })
            .catch((err) => {
            if (err) {
                console.error(`ERROR: can't create folder ${path.dirname(file)}`);
                return;
            }
        });
    }
    copyAsync(src, dst) {
        this.asyncWriteStarted(dst);
        fse.copy(src, dst)
            .then(() => {
            this.asyncWriteDone(dst);
        });
    }
    /*
     * Explores recursively a directory and returns all the filepaths and folderpaths in the callback.
     */
    getFilenames(dir, extension, onDirFiles) {
        var files = Array();
        var dirs = Array();
        //console.info(`getFilenames for ${relDirPath}`)
        var filenames = fs.readdirSync(dir);
        var templateExt = this.templateEngine.getTemplateExtension();
        filenames.forEach((filename) => {
            var file = path.join(dir, filename);
            if (fs.statSync(file).isDirectory()) {
                dirs.push(file);
            }
            else if ((extension === null || filename.endsWith(extension)) && !filename.endsWith(templateExt)) {
                files.push(file);
            }
        });
        onDirFiles(dir, files);
        dirs.forEach((dir) => {
            this.getFilenames(dir, extension, onDirFiles);
        });
    }
}
exports.StaticGen = StaticGen;
//# sourceMappingURL=staticgen.js.map